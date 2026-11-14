package top.domye.dorm;

import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * 全屏沉浸：设计稿自带状态栏与 Home 指示条，系统栏隐藏后画面与设计稿一致，
 * 从边缘上滑可临时唤出系统栏。
 */
public class MainActivity extends BridgeActivity {
    /* 与 index.html 的 #boot-splash、启动主题 splash_background 完全同色 */
    private static final int BRAND = 0xFFBEF22F;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 启动到 WebView 画出第一帧之间有两处默认底色会导致闪白：
        //   1) 窗口背景 —— BridgeActivity 内部 setTheme 换掉启动主题后回到 AppCompat 默认浅色
        //   2) WebView 自身底色 —— 未配置 android.backgroundColor 时是白色
        // 这里在 super 之前就把窗口底色刷成品牌色，super 之后再补一次 WebView 底色，
        // 两层都盖住，启动页 → WebView 的交接就是同色过渡。
        getWindow().setBackgroundDrawable(new ColorDrawable(BRAND));

        // 应用内更新的安装步骤（必须在 super.onCreate 之前注册）
        registerPlugin(ApkInstallPlugin.class);

        super.onCreate(savedInstanceState);

        WebView web = bridge != null ? bridge.getWebView() : null;
        if (web != null) {
            web.setBackgroundColor(BRAND);
            web.getRootView().setBackgroundColor(BRAND);
        }

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        applyImmersive();
    }

    /** 切回前台时重新进入沉浸，避免系统栏被永久唤出 */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    private void applyImmersive() {
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }
}
