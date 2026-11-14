package top.domye.dorm;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 应用内更新：下载安装包到 cache，下载完拉起系统安装器。
 *
 * 拉起安装器前要先确认「安装未知应用」是否已对本应用放开（Android 8+）：
 * 没放开时先跳到该应用自己的开关页，回来后再接着装，不再直接报错/跳浏览器。
 */
@CapacitorPlugin(name = "ApkInstall")
public class ApkInstallPlugin extends Plugin {

    private static final int BUF = 64 * 1024;
    private static final long TICK_MS = 120;

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        final String name = call.getString("name", "update.apk");
        if (url == null || url.isEmpty()) {
            call.reject("missing url");
            return;
        }

        final Context ctx = getContext();
        final Activity act = getActivity();
        if (act == null) {
            call.reject("no activity");
            return;
        }

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                File dir = new File(ctx.getCacheDir(), "update");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("cannot create cache dir");
                File out = new File(dir, name);
                if (out.exists() && !out.delete()) throw new IOException("cannot replace old apk");

                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(20000);
                conn.setInstanceFollowRedirects(true);
                conn.connect();

                int code = conn.getResponseCode();
                if (code != HttpURLConnection.HTTP_OK) throw new IOException("HTTP " + code);

                long total = conn.getContentLengthLong();
                InputStream in = conn.getInputStream();
                FileOutputStream fos = new FileOutputStream(out);
                byte[] buf = new byte[BUF];
                long loaded = 0;
                long last = 0;
                int n;
                while ((n = in.read(buf)) > 0) {
                    fos.write(buf, 0, n);
                    loaded += n;
                    long now = System.currentTimeMillis();
                    if (now - last > TICK_MS) {
                        last = now;
                        emit(act, total > 0 ? (float) loaded / total : -1f, loaded);
                    }
                }
                fos.flush();
                fos.close();
                in.close();

                if (loaded <= 0) throw new IOException("empty apk");
                emit(act, 1f, loaded);

                JSObject ret = new JSObject();
                ret.put("path", "update/" + name);
                ret.put("size", loaded);
                act.runOnUiThread(() -> call.resolve(ret));
            } catch (Exception e) {
                String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                act.runOnUiThread(() -> call.reject(msg, "DOWNLOAD_FAILED"));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    /** 当前是否已经允许本应用安装应用；顺便把状态给前端，便于提前提示。 */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("declared", declaresInstallPermission());
        ret.put("allowed", canInstallPackages());
        call.resolve(ret);
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("missing path", "BAD_ARGS");
            return;
        }

        File file = new File(getContext().getCacheDir(), path);
        if (!file.exists() || file.length() <= 0) {
            call.reject("apk not found", "NO_APK");
            return;
        }

        // 老版本包（清单里没声明这个权限）在系统里根本没有开关可开，只能走网页
        if (!declaresInstallPermission()) {
            call.reject("更新包未声明安装权限，请用网页下载", "NO_PERMISSION_DECLARED");
            return;
        }

        if (!canInstallPackages()) {
            openUnknownSourcesSettings(call);
            return;
        }

        startInstaller(call, file);
    }

    /** 从「安装未知应用」开关页回来：放开了就接着装，没放开就告诉前端去提示。 */
    @ActivityCallback
    private void onUnknownSourcesReturn(PluginCall call, ActivityResult result) {
        if (call == null) return;

        String path = call.getString("path");
        File file = new File(getContext().getCacheDir(), path == null ? "" : path);

        if (!canInstallPackages()) {
            call.reject("请允许本应用安装应用后再试", "NEED_PERMISSION");
            return;
        }
        if (!file.exists() || file.length() <= 0) {
            call.reject("apk not found", "NO_APK");
            return;
        }
        startInstaller(call, file);
    }

    private void openUnknownSourcesSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            startInstaller(call, new File(getContext().getCacheDir(), call.getString("path", "")));
            return;
        }
        Intent intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName()));
        try {
            startActivityForResult(call, intent, "onUnknownSourcesReturn");
        } catch (Exception e) {
            // 部分定制系统没有这个开关页，退到应用详情页（那里也能找到「安装未知应用」）
            try {
                startActivityForResult(call, appDetailsIntent(), "onUnknownSourcesReturn");
            } catch (Exception e2) {
                call.reject("请到系统设置中允许本应用安装应用", "NEED_PERMISSION");
            }
        }
    }

    private Intent appDetailsIntent() {
        return new Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getContext().getPackageName()));
    }

    private void startInstaller(PluginCall call, File file) {
        try {
            Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file);

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("系统未授予安装权限", "NEED_PERMISSION");
        } catch (ActivityNotFoundException e) {
            call.reject("没有可用的安装器", "NO_INSTALLER");
        } catch (Exception e) {
            call.reject("install failed: " + e.getMessage(), "INSTALL_FAILED");
        }
    }

    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        try {
            return getContext().getPackageManager().canRequestPackageInstalls();
        } catch (Exception e) {
            return true;
        }
    }

    private boolean declaresInstallPermission() {
        try {
            PackageInfo info = getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), PackageManager.GET_PERMISSIONS);
            String[] perms = info.requestedPermissions;
            if (perms == null) return false;
            for (String p : perms) {
                if ("android.permission.REQUEST_INSTALL_PACKAGES".equals(p)) return true;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    private void emit(Activity act, float ratio, long loaded) {
        if (act == null) return;
        JSObject d = new JSObject();
        d.put("ratio", ratio);
        d.put("loaded", loaded);
        act.runOnUiThread(() -> notifyListeners("progress", d));
    }
}
