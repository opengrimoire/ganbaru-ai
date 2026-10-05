use super::navigation::*;
use super::*;

pub(super) async fn create_child_preview(
    app: &tauri::AppHandle,
    pool: &SqlitePool,
    request: &OpenPreviewRequest,
    url: reqwest::Url,
    bounds: PreviewBounds,
) -> ChatResult<PreviewTabRead> {
    use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
    let label = preview_label(&request.tab_id);
    let allowed_url = Arc::new(Mutex::new(url.clone()));
    let navigation_url = allowed_url.clone();
    let manager = app.state::<ChatPreviewManager>().inner().clone();
    let loading_tab = request.tab_id.clone();
    let loading_pool = pool.clone();
    let title_manager = manager.clone();
    let title_tab = request.tab_id.clone();
    let title_pool = pool.clone();
    let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(url.clone()))
        .on_navigation(move |candidate| {
            navigation_url
                .lock()
                .is_ok_and(|allowed| navigation_allowed(&allowed, candidate))
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .on_page_load(move |_, payload| {
            manager.update(&loading_tab, |read| {
                read.current_url = payload.url().to_string();
                read.loading = payload.event() == PageLoadEvent::Started;
                read.external_origin = !is_loopback(payload.url());
            });
            persist_runtime_tab(&manager, &loading_pool, &loading_tab);
        })
        .on_document_title_changed(move |_, title| {
            title_manager.update(&title_tab, |read| read.title = title);
            persist_runtime_tab(&title_manager, &title_pool, &title_tab);
        });
    let main = app.get_window("main").ok_or_else(preview_unavailable)?;
    main.add_child(
        builder,
        tauri::LogicalPosition::new(bounds.x, bounds.y),
        tauri::LogicalSize::new(bounds.width, bounds.height),
    )
    .map_err(|_| preview_unavailable())?;
    let read = PreviewTabRead {
        thread_id: request.thread_id.clone(),
        tab_id: request.tab_id.clone(),
        current_url: url.to_string(),
        title: String::new(),
        visible: true,
        loading: true,
        viewport_width: bounds.width.round() as u32,
        viewport_height: bounds.height.round() as u32,
        external_origin: !is_loopback(&url),
    };
    app.state::<ChatPreviewManager>()
        .tabs
        .lock()
        .map_err(|_| preview_state_error())?
        .insert(
            request.tab_id.clone(),
            RuntimePreviewTab {
                read: read.clone(),
                webview_label: label,
                allowed_url,
            },
        );
    persist_tab(pool, &read).await?;
    Ok(read)
}

pub(super) fn persist_runtime_tab(manager: &ChatPreviewManager, pool: &SqlitePool, tab_id: &str) {
    let Ok(tab) = manager.read(tab_id) else {
        return;
    };
    let pool = pool.clone();
    tauri::async_runtime::spawn(async move {
        let _ = persist_tab(&pool, &tab.read).await;
    });
}

#[cfg(mobile)]
pub(super) async fn create_child_preview(
    _app: &tauri::AppHandle,
    _pool: &SqlitePool,
    _request: &OpenPreviewRequest,
    _url: reqwest::Url,
    _bounds: PreviewBounds,
) -> ChatResult<PreviewTabRead> {
    Err(ChatError::unsupported(
        "Embedded browser preview is unavailable on this platform",
    ))
}

pub(super) fn owned_tab(
    app: &tauri::AppHandle,
    thread_id: &ChatThreadId,
    tab_id: &str,
) -> ChatResult<RuntimePreviewTab> {
    let tab = app.state::<ChatPreviewManager>().read(tab_id)?;
    if &tab.read.thread_id != thread_id {
        return Err(ChatError::new(
            ChatErrorCode::Permission,
            "Browser preview tab belongs to another thread",
            true,
        ));
    }
    Ok(tab)
}

pub(super) fn navigate_existing(
    app: &tauri::AppHandle,
    tab: &RuntimePreviewTab,
    url: reqwest::Url,
) -> ChatResult<()> {
    let webview = app
        .get_webview(&tab.webview_label)
        .ok_or_else(preview_unavailable)?;
    let previous = {
        let mut allowed = tab.allowed_url.lock().map_err(|_| preview_state_error())?;
        let previous = allowed.clone();
        *allowed = url.clone();
        previous
    };
    let result = webview.navigate(url).map_err(|_| preview_unavailable());
    if result.is_err() {
        *tab.allowed_url.lock().map_err(|_| preview_state_error())? = previous;
    }
    result
}

pub(super) fn resize_existing(
    app: &tauri::AppHandle,
    tab: &RuntimePreviewTab,
    bounds: &PreviewBounds,
) -> ChatResult<()> {
    let webview = app
        .get_webview(&tab.webview_label)
        .ok_or_else(preview_unavailable)?;
    webview
        .set_position(tauri::LogicalPosition::new(bounds.x, bounds.y))
        .and_then(|_| webview.set_size(tauri::LogicalSize::new(bounds.width, bounds.height)))
        .map_err(|_| preview_unavailable())
}

pub(super) fn eval_fixed(
    app: &tauri::AppHandle,
    thread_id: &ChatThreadId,
    tab_id: &str,
    script: &str,
) -> ChatResult<()> {
    let tab = owned_tab(app, thread_id, tab_id)?;
    app.get_webview(&tab.webview_label)
        .ok_or_else(preview_unavailable)?
        .eval(script)
        .map_err(|_| preview_unavailable())
}

pub(crate) async fn evaluate_script(
    app: &tauri::AppHandle,
    thread_id: &ChatThreadId,
    tab_id: &str,
    script: &str,
) -> ChatResult<String> {
    let tab = owned_tab(app, thread_id, tab_id)?;
    let webview = app
        .get_webview(&tab.webview_label)
        .ok_or_else(preview_unavailable)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(sender)));
    webview
        .eval_with_callback(script, move |result| {
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(result);
                }
            }
        })
        .map_err(|_| preview_unavailable())?;
    let result = tokio::time::timeout(PREVIEW_EVALUATION_TIMEOUT, receiver)
        .await
        .map_err(|_| ChatError::new(ChatErrorCode::Timeout, "Browser evaluation timed out", true))?
        .map_err(|_| preview_unavailable())?;
    if result.len() > MAX_PREVIEW_RESULT_BYTES {
        return Err(ChatError::new(
            ChatErrorCode::Protocol,
            "Browser result exceeds the supported limit",
            true,
        ));
    }
    Ok(result)
}
