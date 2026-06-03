#[cfg(target_os = "linux")]
mod linux {
    use gtk::cairo::{RectangleInt, Region};
    use gtk::prelude::*;
    use tauri::Manager;

    const REGULAR_RADIUS_PX: i32 = 8;
    const COMPACT_RADIUS_PX: i32 = 6;
    const NARROW_RADIUS_PX: i32 = 4;
    const MICRO_WIDTH_PX: i32 = 390;
    const MICRO_HEIGHT_PX: i32 = 360;
    const NARROW_WIDTH_PX: i32 = 560;
    const COMPACT_WIDTH_PX: i32 = 800;
    const COMPACT_HEIGHT_PX: i32 = 600;

    pub fn setup_main_window(app: &tauri::AppHandle) -> Result<(), String> {
        let Some(window) = app.get_webview_window("main") else {
            return Ok(());
        };
        window
            .set_background_color(Some(tauri::window::Color(0, 0, 0, 0)))
            .map_err(|e| e.to_string())?;

        let gtk_window = window.gtk_window().map_err(|e| e.to_string())?;
        apply_main_window_shape(&gtk_window);
        gtk_window.connect_size_allocate(|window, _| apply_main_window_shape(window));
        gtk_window.connect_is_maximized_notify(apply_main_window_shape);
        Ok(())
    }

    fn apply_main_window_shape(window: &gtk::ApplicationWindow) {
        if window.is_maximized() {
            window.shape_combine_region(None);
            window.input_shape_combine_region(None);
            return;
        }

        let allocation = window.allocation();
        let width = allocation.width();
        let height = allocation.height();
        let radius = window_radius_px(width, height);

        if width <= 0 || height <= 0 || radius <= 0 {
            window.shape_combine_region(None);
            window.input_shape_combine_region(None);
            return;
        }

        let region = rounded_rect_region(width, height, radius);
        window.shape_combine_region(Some(&region));
        window.input_shape_combine_region(Some(&region));
    }

    fn window_radius_px(width: i32, height: i32) -> i32 {
        if width < MICRO_WIDTH_PX || height < MICRO_HEIGHT_PX {
            0
        } else if width < NARROW_WIDTH_PX {
            NARROW_RADIUS_PX
        } else if width < COMPACT_WIDTH_PX || height < COMPACT_HEIGHT_PX {
            COMPACT_RADIUS_PX
        } else {
            REGULAR_RADIUS_PX
        }
    }

    fn rounded_rect_region(width: i32, height: i32, radius: i32) -> Region {
        let radius = radius.min(width / 2).min(height / 2);
        let mut rows = Vec::with_capacity(height as usize);

        for y in 0..height {
            let inset = rounded_corner_inset(y, height, radius);
            rows.push(RectangleInt::new(inset, y, (width - inset * 2).max(0), 1));
        }

        Region::create_rectangles(&rows)
    }

    fn rounded_corner_inset(y: i32, height: i32, radius: i32) -> i32 {
        if radius <= 0 {
            return 0;
        }

        let corner_y = if y < radius {
            radius - y
        } else if y >= height - radius {
            y - (height - radius - 1)
        } else {
            return 0;
        };
        let radius_squared = radius * radius;
        let dy_squared = corner_y * corner_y;
        let x = ((radius_squared - dy_squared).max(0) as f64).sqrt().round() as i32;

        (radius - x).max(0)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn window_radius_tracks_viewport_size_classes() {
            assert_eq!(window_radius_px(280, 180), 0);
            assert_eq!(window_radius_px(500, 700), NARROW_RADIUS_PX);
            assert_eq!(window_radius_px(700, 500), COMPACT_RADIUS_PX);
            assert_eq!(window_radius_px(1200, 800), REGULAR_RADIUS_PX);
        }

        #[test]
        fn rounded_corner_inset_only_trims_corner_rows() {
            let height = 100;
            let radius = 8;

            assert!(rounded_corner_inset(0, height, radius) > 0);
            assert_eq!(rounded_corner_inset(radius, height, radius), 0);
            assert_eq!(rounded_corner_inset(height / 2, height, radius), 0);
            assert!(rounded_corner_inset(height - 1, height, radius) > 0);
        }
    }
}

#[cfg(target_os = "linux")]
pub use linux::setup_main_window;

#[cfg(not(target_os = "linux"))]
pub fn setup_main_window(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}
