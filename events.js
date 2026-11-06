// js/events.js
let nextEventId = 1;
const eventQueue = [];
// 誰も drainEvents しない環境(ブラウザ単独・測定)でキューが無限に伸びないよう上限を設ける
const EVENT_QUEUE_MAX = 5000;
const eventListeners = new Set();

export function emitEvent(type, payload = {}) {
  const event = {
    eventId: payload.eventId || nextEventId++,
    type,
    ...payload
  };
  eventQueue.push(event);
  if (eventQueue.length > EVENT_QUEUE_MAX) eventQueue.splice(0, eventQueue.length - EVENT_QUEUE_MAX);
  eventListeners.forEach((listener) => {
    try {
      listener(event);
    } catch (e) {
      console.error(e);
    }
  });
  return event;
}

export function getLatestEventId() {
  return nextEventId - 1;
}

export function addEventListener(listener) {
  eventListeners.add(listener);
}

export function removeEventListener(listener) {
  eventListeners.delete(listener);
}

export function drainEvents() {
  const events = [...eventQueue];
  eventQueue.length = 0;
  return events;
}

export function resetEvents() {
  eventQueue.length = 0;
  nextEventId = 1;
}
