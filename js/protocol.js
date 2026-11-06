// js/protocol.js
// サーバーとクライアント間の通信仕様バージョン定義

export const PROTOCOL_VERSION = "2.1.0";
// 2.1.0: 観戦者(枠なし参加)を追加。assignedCharKey が null になりうる / SPECTATE メッセージ / 接続URLの spectate=1
