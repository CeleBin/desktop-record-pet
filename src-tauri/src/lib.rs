mod commands;
mod db;
mod errors;
mod models;
mod screenshot;
mod windows;

use std::sync::Mutex;

use tauri::menu::{IsMenuItem, Menu, MenuItem};
use tauri::Manager;
use tauri::WindowEvent;
// 引入 Image 类型
use tauri::image::Image;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

/// Tracks the currently-active shortcut accelerators so `set_shortcut`
/// can unregister the old accelerator before registering the new one.
pub struct ShortcutState {
    pub quick_capture: Mutex<String>,
    pub screenshot: Mutex<String>,
}

fn register_shortcut_best_effort<F>(shortcut_name: &str, register: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    match register() {
        Ok(()) => Ok(()),
        Err(error) => {
            eprintln!(
                "warning: failed to register shortcut '{shortcut_name}', continuing without it: {error}"
            );
            Ok(())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_local_data_dir()
                .map_err(|error| error.to_string())?;

            let database = db::init_db(&app_data_dir).map_err(|error| error.to_string())?;

            // Read persisted shortcut accelerators (or fall back to built-in defaults).
            let quick_accel = {
                let conn = database.conn.lock().map_err(|e| e.to_string())?;
                db::get_setting_or(&conn, "quick_capture_shortcut", "Alt+Shift+R")
                    .map_err(|e| e.to_string())?
            };
            let screenshot_accel = {
                let conn = database.conn.lock().map_err(|e| e.to_string())?;
                db::get_setting_or(&conn, "screenshot_shortcut", "Alt+Shift+S")
                    .map_err(|e| e.to_string())?
            };

            app.manage(database);
            app.manage(ShortcutState {
                quick_capture: Mutex::new(quick_accel.clone()),
                screenshot: Mutex::new(screenshot_accel.clone()),
            });
            windows::ensure_window_runtime_ready().map_err(|error| error.to_string())?;

            for label in [windows::MAIN_PANEL_LABEL, windows::PET_LABEL, windows::TODO_OVERLAY_LABEL] {
                if windows::should_hide_instead_of_close(label) {
                    let window = app
                        .get_webview_window(label)
                        .ok_or_else(|| format!("window {label} not found during setup"))?;
                    let window_handle = window.clone();
                    window.on_window_event(move |event| {
                        if let WindowEvent::CloseRequested { api, .. } = event {
                            let _ = window_handle.hide();
                            api.prevent_close();
                        }
                    });
                }
            }

            // Quick text capture
            {
                let shortcut: Shortcut = quick_accel
                    .parse()
                    .map_err(|error| format!("failed to parse quick capture shortcut: {error}"))?;

                register_shortcut_best_effort("quick capture", || {
                    app.global_shortcut()
                        .on_shortcut(shortcut, |app, _shortcut, event| {
                            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                                let _ = windows::show_quick_input(app);
                            }
                        })
                        .map_err(|error| {
                            format!("failed to register quick capture shortcut: {error}")
                        })
                })?;
            }

            // Screenshot overlay
            {
                let shortcut: Shortcut = screenshot_accel
                    .parse()
                    .map_err(|error| format!("failed to parse screenshot shortcut: {error}"))?;

                register_shortcut_best_effort("screenshot capture", || {
                    app.global_shortcut()
                        .on_shortcut(shortcut, |app, _shortcut, event| {
                            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                                let _ =
                                    windows::show_window(app, windows::SCREENSHOT_OVERLAY_LABEL);
                            }
                        })
                        .map_err(|error| {
                            format!("failed to register screenshot shortcut: {error}")
                        })
                })?;
            }

            // ── System tray ─────────────────────────────────────────────
            let handle = app.handle();
            let show_hide = MenuItem::with_id(
                handle,
                "show_hide",
                "Show/Hide Main Panel",
                true,
                None::<&str>,
            )
            .map_err(|error| error.to_string())?;
            let toggle_pet_item = MenuItem::with_id(
                handle,
                "toggle_pet",
                "Show/Hide Pet",
                true,
                None::<&str>,
            )
            .map_err(|error| error.to_string())?;
            let toggle_todo_overlay_item = MenuItem::with_id(
                handle,
                "toggle_todo_overlay",
                "Show/Hide Todo Overlay",
                true,
                None::<&str>,
            )
            .map_err(|error| error.to_string())?;
            let quit = MenuItem::with_id(handle, "quit", "Quit", true, None::<&str>)
                .map_err(|error| error.to_string())?;

            let menu = Menu::with_items(
                handle,
                &[
                    &show_hide as &dyn IsMenuItem<_>,
                    &toggle_pet_item as &dyn IsMenuItem<_>,
                    &toggle_todo_overlay_item as &dyn IsMenuItem<_>,
                    &quit as &dyn IsMenuItem<_>,
                ],
            )
            .map_err(|error| error.to_string())?;
            // 编译时将 icon.png 嵌入二进制，解出 RGBA 像素
            let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))
                .map_err(|e| e.to_string())?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                // 加入托盘图标
                .icon(icon)
                .menu(&menu)
                .tooltip("Desktop Record Pet")
                .on_menu_event(|app_handle, event| match event.id().as_ref() {
                    "show_hide" => {
                        let _ = windows::show_main_panel(app_handle);
                    }
                    "toggle_pet" => {
                        let _ = windows::toggle_pet(app_handle);
                    }
                    "toggle_todo_overlay" => {
                        let _ = windows::toggle_todo_overlay(app_handle);
                    }
                    "quit" => {
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .build(app)
                .map_err(|error| error.to_string())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_record,
            commands::show_main_panel,
            commands::hide_window,
            commands::show_window,
            commands::import_files,
            commands::import_clipboard_image,
            commands::add_attachments_to_record,
            commands::capture_screenshot,
            commands::save_screenshot_record,
            // Task 7: record & task browsing
            commands::list_records,
            commands::get_record_detail,
            commands::update_record,
            commands::delete_record,
            commands::create_task,
            commands::convert_record_to_task,
            commands::list_tasks,
            commands::update_task_status,
            commands::update_task_due_at,
            commands::update_task_repeat_rule,
            commands::remove_task,
            commands::list_unfinished_tasks,
            commands::reorder_tasks,
            // Folder category commands
            commands::list_folders,
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::move_task_to_folder,
            commands::reorder_folders,
            // Tag commands
            commands::create_tag,
            commands::list_tags,
            commands::update_tag,
            commands::delete_tag,
            commands::set_record_tags,
            commands::list_record_tags,
            // Task 9: pet window & tray
            commands::get_pet_position,
            commands::set_pet_position,
            commands::toggle_pet_window,
            // Task 10: settings & AI enhancement
            commands::get_all_settings,
            commands::update_setting,
            commands::reset_settings,
            commands::create_ai_result,
            commands::request_ai_enhancement,
            // Editable global shortcuts
            commands::set_shortcut,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::register_shortcut_best_effort;

    #[test]
    fn shortcut_registration_failure_is_non_fatal() {
        let result = register_shortcut_best_effort("quick capture", || {
            Err("HotKey already registered".to_string())
        });

        assert!(result.is_ok());
    }

    #[test]
    fn shortcut_registration_success_stays_successful() {
        let result = register_shortcut_best_effort("quick capture", || Ok(()));

        assert!(result.is_ok());
    }
}
