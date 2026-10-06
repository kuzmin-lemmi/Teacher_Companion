package ru.teachercompanion.lessons

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class SyncArgs {
    var payload: String? = null
}

@InvokeArg
class PinArgs {
    var kind: String? = null
}

@InvokeArg
class PreviewArgs {
    /** `remind` или `morning` */
    var kind: String? = null
    /** `chime`, `vibrate` или `silent` */
    var sound: String? = null
}

/** Команды для приложения: `plugin:lessons|sync` и другие (src/phone.ts). */
@TauriPlugin
class LessonsPlugin(private val activity: Activity) : Plugin(activity) {
    override fun load(webView: WebView) {
        super.load(webView)
        // При каждом запуске — заново поставить будильник: его могли снять после обновления.
        Scheduler.refresh(activity)
    }

    @Command
    fun sync(invoke: Invoke) {
        val payload = invoke.parseArgs(SyncArgs::class.java).payload
        if (payload == null) {
            invoke.reject("Нет плана уроков")
            return
        }
        try {
            Plan.parse(payload)
        } catch (e: Exception) {
            invoke.reject("План уроков не читается: ${e.message}")
            return
        }
        Plan.save(activity, payload)
        Scheduler.refresh(activity)
        invoke.resolve()
    }

    @Command
    fun status(invoke: Invoke) {
        val result = JSObject()
        result.put("notifications", NotificationManagerCompat.from(activity).areNotificationsEnabled())
        result.put("exact", Scheduler.canExact(activity))
        val power = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
        result.put("battery", power.isIgnoringBatteryOptimizations(activity.packageName))
        result.put("widgets", Widgets.count(activity))
        result.put(
            "pin",
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                AppWidgetManager.getInstance(activity).isRequestPinAppWidgetSupported,
        )
        invoke.resolve(result)
    }

    /** Разрешить уведомления: системный запрос, а если его уже отклоняли — настройки. */
    @Command
    fun notifications(invoke: Invoke) {
        val prefs = activity.getSharedPreferences("teacher_companion_lessons", Context.MODE_PRIVATE)
        val asked = prefs.getInt("notification_requests", 0)
        val granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted && asked < 2) {
            prefs.edit().putInt("notification_requests", asked + 1).apply()
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                4201,
            )
        } else {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
            else appDetails()
            start(intent)
        }
        invoke.resolve()
    }

    /** Разрешить работу в фоне — иначе оболочки вроде ColorOS и MIUI усыпляют будильник. */
    @SuppressLint("BatteryLife")
    @Command
    fun battery(invoke: Invoke) {
        val power = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!power.isIgnoringBatteryOptimizations(activity.packageName))
            start(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                    .setData(Uri.parse("package:${activity.packageName}")),
            )
        else start(appDetails())
        invoke.resolve()
    }

    /** Показать пример напоминания или утренней сводки — услышать выбранный звук. */
    @Command
    fun preview(invoke: Invoke) {
        val args = invoke.parseArgs(PreviewArgs::class.java)
        Scheduler.preview(activity, args.kind ?: "remind", Sound.of(args.sound ?: ""))
        invoke.resolve()
    }

    /**
     * Кто установил приложение: `ru.vk.store` — RuStore, пусто — файл APK из браузера.
     * В версии из магазина нет ссылок на скачивание APK — обновления приходят через магазин.
     */
    @Suppress("DEPRECATION")
    @Command
    fun installer(invoke: Invoke) {
        val name = activity.packageName
        val source = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
                activity.packageManager.getInstallSourceInfo(name).installingPackageName
            else activity.packageManager.getInstallerPackageName(name)
        } catch (e: Exception) {
            null
        }
        val result = JSObject()
        result.put("installer", source ?: "")
        invoke.resolve(result)
    }

    /** Предложить лаунчеру поставить виджет на рабочий стол. */
    @Command
    fun pin(invoke: Invoke) {
        val kind = invoke.parseArgs(PinArgs::class.java).kind
        val provider = ComponentName(
            activity,
            if (kind == "day") DayWidget::class.java else NowWidget::class.java,
        )
        val manager = AppWidgetManager.getInstance(activity)
        val ok = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            manager.isRequestPinAppWidgetSupported &&
            manager.requestPinAppWidget(provider, null, null)
        val result = JSObject()
        result.put("ok", ok)
        invoke.resolve(result)
    }

    private fun appDetails() =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.parse("package:${activity.packageName}"))

    private fun start(intent: Intent) {
        try {
            activity.startActivity(intent)
        } catch (e: Exception) {
            activity.startActivity(appDetails())
        }
    }
}
