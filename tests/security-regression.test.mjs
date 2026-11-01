import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRoom } from '../roomCore.js';
import { FakeConn } from './helpers.mjs';
import { PROTOCOL_VERSION } from '../js/protocol.js';

test('room URL is never interpolated into innerHTML', () => {
  const client = fs.readFileSync(new URL('../js/netClient.js', import.meta.url), 'utf8');
  assert.doesNotMatch(client, /<span id="room-status-text">部屋: \[\$\{this\.roomId\}\]/);
  assert.match(client, /querySelector\("#room-status-text"\)\.textContent/);
});

test('idle host transfers permissions without disconnecting either participant', () => {
  const room = createRoom({hostIdleMs: 100});
  try {
    const first = new FakeConn(), second = new FakeConn();
    const join = (conn,token) => room.handleConnection(conn, {token, room:'main', version:PROTOCOL_VERSION});
    assert.equal(join(first,'token_first_secure_1111'),true);
    assert.equal(join(second,'token_second_secure_2222'),true);
    const oldHost = room.hostToken;
    room.hostActivityAt = Date.now() - 200;
    room.tick();
    assert.notEqual(room.hostToken,oldHost);
    assert.equal(room.clients.size,2);
    assert.equal(room.sessions.get(oldHost).connected,true);
    assert.equal(room.rosterMessage().hostId,second.last('INIT').playerId);
  } finally { room.dispose(); }
});
