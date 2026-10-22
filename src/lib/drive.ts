import "server-only";
import { db } from "./db";
import { googleFetch } from "./google";
import { getSetting, setSetting } from "./settings";
import {
  CLIENT_SUBFOLDERS,
  DRIVE_SUBFOLDER_NAMES,
  PROSPECT_SUBFOLDERS,
  isClientStage,
  type DrivePurpose,
} from "./constants";

// Folder system (all created by the app, so the narrow drive.file scope is enough):
//
//   Dawn Patrol Co — CRM/
//     00 Company/            exports, reports, templates
//     01 Prospects/<Account (domain)>/{01 Research, 02 Outreach}
//     02 Clients/<Account (domain)>/{01 Research … 06 Billing}
//
// When a prospect converts, its folder is moved from 01 Prospects to 02 Clients and the
// client-only subfolders are added. Ids are stored in DriveFolder so names can change freely.

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DOC_MIME = "application/vnd.google-apps.document";

type DriveFile = { id: string; webViewLink?: string; parents?: string[] };

async function createFolder(name: string, parentId?: string): Promise<DriveFile> {
  return googleFetch<DriveFile>(`${API}?fields=id,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  });
}

async function folderExists(id: string): Promise<boolean> {
  try {
    const f = await googleFetch<{ trashed?: boolean }>(`${API}/${id}?fields=id,trashed`);
    return !f.trashed;
  } catch {
    return false;
  }
}

async function ensureSettingFolder(key: string, name: string, parentId?: string): Promise<string> {
  const existing = await getSetting(key);
  if (existing && (await folderExists(existing))) return existing;
  const folder = await createFolder(name, parentId);
  await setSetting(key, folder.id);
  return folder.id;
}

export async function ensureRootFolders(): Promise<{ root: string; company: string; prospects: string; clients: string }> {
  const root = await ensureSettingFolder("drive.root", process.env.GOOGLE_DRIVE_ROOT_NAME || "Dawn Patrol Co — CRM");
  const [company, prospects, clients] = await Promise.all([
    ensureSettingFolder("drive.company", "00 Company", root),
    ensureSettingFolder("drive.prospects", "01 Prospects", root),
    ensureSettingFolder("drive.clients", "02 Clients", root),
  ]);
  return { root, company, prospects, clients };
}

export function accountFolderName(a: { name: string; domain: string | null }): string {
  return a.domain ? `${a.name} (${a.domain})` : a.name;
}

/** Idempotent: creates whatever is missing for the account's current stage and files it in the right parent. */
export async function ensureAccountFolders(accountId: string): Promise<Record<string, { driveId: string; url: string }>> {
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, include: { driveFolders: true } });
  const roots = await ensureRootFolders();
  const isClient = isClientStage(account.stage) || account.stage === "CHURNED";
  const parent = isClient ? roots.clients : roots.prospects;
  const byPurpose = new Map(account.driveFolders.map((f) => [f.purpose, f]));

  let root = byPurpose.get("ROOT");
  if (root && !(await folderExists(root.driveId))) {
    await db.driveFolder.deleteMany({ where: { accountId } });
    byPurpose.clear();
    root = undefined;
  }
  if (!root) {
    const created = await createFolder(accountFolderName(account), parent);
    root = await db.driveFolder.create({
      data: { accountId, purpose: "ROOT", driveId: created.id, url: created.webViewLink ?? `https://drive.google.com/drive/folders/${created.id}` },
    });
    byPurpose.set("ROOT", root);
  } else {
    // Move between Prospects/Clients when the stage changes.
    const meta = await googleFetch<DriveFile>(`${API}/${root.driveId}?fields=id,parents`);
    const parents = meta.parents ?? [];
    if (!parents.includes(parent)) {
      const remove = parents.filter((p) => p === roots.prospects || p === roots.clients).join(",");
      await googleFetch(`${API}/${root.driveId}?addParents=${parent}${remove ? `&removeParents=${remove}` : ""}&fields=id`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    }
  }

  const wanted = isClient ? CLIENT_SUBFOLDERS : PROSPECT_SUBFOLDERS;
  for (const purpose of wanted) {
    if (byPurpose.has(purpose)) continue;
    const created = await createFolder(DRIVE_SUBFOLDER_NAMES[purpose], root.driveId);
    const row = await db.driveFolder.create({
      data: { accountId, purpose, driveId: created.id, url: created.webViewLink ?? `https://drive.google.com/drive/folders/${created.id}` },
    });
    byPurpose.set(purpose, row);
  }

  await db.account.update({ where: { id: accountId }, data: { driveFolderId: root.driveId, driveFolderUrl: root.url } });
  return Object.fromEntries(Array.from(byPurpose.entries()).map(([k, v]) => [k, { driveId: v.driveId, url: v.url }]));
}

function multipartBody(metadata: object, content: string): { body: string; boundary: string } {
  const boundary = `dp${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
  return { body, boundary };
}

/**
 * Write a text document (converted to a Google Doc) into one of the account's folders.
 * Pass existingFileId to overwrite in place (keeps the same link).
 */
export async function writeAccountDoc(
  accountId: string,
  purpose: Exclude<DrivePurpose, "ROOT">,
  name: string,
  content: string,
  existingFileId?: string | null,
): Promise<{ id: string; url: string }> {
  if (existingFileId) {
    try {
      const updated = await googleFetch<DriveFile>(`${UPLOAD}/${existingFileId}?uploadType=media&fields=id,webViewLink`, {
        method: "PATCH",
        headers: { "Content-Type": "text/plain; charset=UTF-8" },
        body: content,
      });
      return { id: updated.id, url: updated.webViewLink ?? `https://docs.google.com/document/d/${updated.id}` };
    } catch {
      // fall through and create a new file (e.g. the old one was deleted)
    }
  }
  const folders = await ensureAccountFolders(accountId);
  const folder = folders[purpose] ?? folders.ROOT!;
  const { body, boundary } = multipartBody({ name, mimeType: DOC_MIME, parents: [folder.driveId] }, content);
  const created = await googleFetch<DriveFile>(`${UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return { id: created.id, url: created.webViewLink ?? `https://docs.google.com/document/d/${created.id}` };
}

/** Company-level documents (e.g. CRM exports) in 00 Company. */
export async function writeCompanyDoc(name: string, content: string): Promise<{ id: string; url: string }> {
  const roots = await ensureRootFolders();
  const { body, boundary } = multipartBody({ name, mimeType: DOC_MIME, parents: [roots.company] }, content);
  const created = await googleFetch<DriveFile>(`${UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return { id: created.id, url: created.webViewLink ?? `https://docs.google.com/document/d/${created.id}` };
}
