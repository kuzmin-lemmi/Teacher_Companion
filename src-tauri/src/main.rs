#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_sql::{Migration, MigrationKind};

const MENU_OPEN: &str = "Открыть";
const MENU_TODAY: &str = "Сегодня";
const MENU_NEXT: &str = "Следующий учебный день";
const MENU_SETTINGS: &str = "Настройки";
const MENU_QUIT: &str = "Завершить приложение";

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial_local_state",
            sql: include_str!("../../src/schema.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "drafts_and_snapshots",
            sql: include_str!("../../src/schema-v2.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app);
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![quit_app])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:teacher-companion.db", migrations())
                .build(),
        )
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", MENU_OPEN, true, None::<&str>)?;
            let today = MenuItem::with_id(app, "today", MENU_TODAY, true, None::<&str>)?;
            let next = MenuItem::with_id(app, "next", MENU_NEXT, true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", MENU_SETTINGS, true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", MENU_QUIT, true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &today, &next, &settings, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Помощник учителя")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    show_main(app);
                    let _ = app.emit("tray-action", event.id.as_ref());
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                        let _ = tray.app_handle().emit("tray-action", "open");
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Не удалось запустить Помощник учителя");
}
