package com.headabovedigital.crm;

import android.app.Application;
import android.os.Build;

import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Sends a crash report (the error and stack trace, app and Android version, phone model) to the
 * CRM's /api/app-crash before the app closes, so a crash on a phone can be diagnosed without a
 * computer. Nothing else is sent: no account, page or personal data.
 */
public class CrmApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        final String url = "https://" + getString(R.string.hostName) + "/api/app-crash";
        String version = "?";
        try {
            version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception ignored) {
        }
        final String app = version;
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                StringWriter trace = new StringWriter();
                error.printStackTrace(new PrintWriter(trace));
                final String report = "app " + app + " | Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ") | "
                        + Build.MANUFACTURER + " " + Build.MODEL + " | thread " + thread.getName() + "\n" + trace;
                Thread sender = new Thread(() -> send(url, report));
                sender.start();
                sender.join(4000);
            } catch (Throwable ignored) {
            }
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }

    private static void send(String url, String report) {
        HttpURLConnection connection = null;
        try {
            byte[] body = report.substring(0, Math.min(report.length(), 15000)).getBytes(StandardCharsets.UTF_8);
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(3000);
            connection.setReadTimeout(3000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "text/plain; charset=utf-8");
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
            }
            connection.getResponseCode();
        } catch (Throwable ignored) {
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
