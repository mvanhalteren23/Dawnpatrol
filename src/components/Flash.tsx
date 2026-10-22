import { Notice } from "./ui";

export function Flash({ params }: { params: { notice?: string; error?: string } }) {
  return (
    <>
      {params.notice ? <Notice kind="success">{params.notice}</Notice> : null}
      {params.error ? <Notice kind="error">{params.error}</Notice> : null}
    </>
  );
}
