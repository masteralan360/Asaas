use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
        Request,
    },
    response::IntoResponse,
    routing::get,
    middleware::{self, Next},
    Router,
};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tower_http::services::ServeDir;
use tower_http::cors::CorsLayer;
use tauri::{AppHandle, Manager};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KdsMessage {
    pub event: String,
    pub payload: serde_json::Value,
}

pub struct AppState {
    pub tx: broadcast::Sender<String>,
}

pub async fn start_server(app_handle: AppHandle, port: u16) -> Result<String, String> {
    let (tx, _rx) = broadcast::channel(100);
    let app_state = Arc::new(AppState { tx: tx.clone() });

    // Determine local IP
    let local_ip = if_addrs::get_if_addrs()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|iface| !iface.is_loopback() && iface.ip().is_ipv4())
        .map(|iface| iface.ip().to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string());

    // Path to static assets
    let resource_path = app_handle.path().resource_dir().map_err(|e| e.to_string())?;
    let mut dist_path = resource_path.join("dist");

    // In dev mode, resource_dir might be src-tauri, so dist is in the parent.
    if !dist_path.exists() {
        if let Some(parent) = resource_path.parent() {
            let alt_dist = parent.join("dist");
            if alt_dist.exists() {
                dist_path = alt_dist;
            }
        }
    }

    println!("[KDS Server] Starting server on {}:{}", local_ip, port);
    println!("[KDS Server] Serving static files from: {:?}", dist_path);

    let app = Router::new()
        .fallback_service(ServeDir::new(dist_path))
        .route("/ws", get(ws_handler))
        .layer(CorsLayer::permissive())
        .layer(middleware::from_fn(log_requests))
        .with_state(app_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    
    tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
        axum::serve(listener, app).await.unwrap();
    });

    Ok(format!("http://{}:{}", local_ip, port))
}

async fn log_requests(req: Request, next: Next) -> axum::response::Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    println!("[KDS HTTP] {} {}", method, uri);
    
    let response = next.run(req).await;
    
    if response.status().is_client_error() || response.status().is_server_error() {
        println!("[KDS HTTP ERROR] {} {} -> {}", method, uri, response.status());
    }
    
    response
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    println!("[KDS WS] New WebSocket connection requested!");
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    println!("[KDS WS] Client fully connected!");
    let mut rx = state.tx.subscribe();

    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            println!("[KDS WS] Sending message to client...");
            if socket.send(Message::Text(msg)).await.is_err() {
                println!("[KDS WS] Failed to send message (client disconnected?)");
                break;
            }
        }
    });

    // We don't necessarily need to receive messages from the client yet,
    // but we can add logic here if needed.
    tokio::select! {
        _ = (&mut send_task) => {
            println!("[KDS WS] Send task ended.");
        },
    }
    println!("[KDS WS] Client connection closed.");
}

pub fn broadcast_message(state: &AppState, message: KdsMessage) -> Result<(), String> {
    let json = serde_json::to_string(&message).map_err(|e| e.to_string())?;
    let _ = state.tx.send(json);
    Ok(())
}
