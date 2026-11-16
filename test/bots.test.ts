import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cooldownReady,
  isNewChatCommand,
  parseBotChannels,
  pollDecision,
  readBotResponse,
  splitDiscordMessage,
} from '../src/bots';

describe('BOT_CHANNELS', () => {
  it('parses name and channel id pairs and drops bad or duplicate entries', () => {
    assert.deepEqual(parseBotChannels(' hestia:11111 , iris:22222, bad, nope:abc, hestia:33333, other:22222 '), [
      { name: 'hestia', channelId: '11111' },
      { name: 'iris', channelId: '22222' },
    ]);
    assert.deepEqual(parseBotChannels(undefined), []);
    assert.deepEqual(parseBotChannels('   '), []);
  });
});

describe('message splitting', () => {
  it('leaves a short message as one piece', () => {
    assert.deepEqual(splitDiscordMessage('hello'), ['hello']);
  });

  it('splits a long plain message into 2000-character pieces', () => {
    const text = 'a'.repeat(4500);
    const parts = splitDiscordMessage(text);
    assert.ok(parts.length > 1);
    assert.ok(parts.every((part) => part.length <= 2000));
    assert.equal(parts.join(''), text);
  });

  it('closes and reopens a code fence that crosses the limit', () => {
    const body = Array.from({ length: 80 }, (_, index) => `line ${index} ${'x'.repeat(40)}`).join('\n');
    const text = `intro\n\`\`\`ts\n${body}\n\`\`\`\nout`;
    const parts = splitDiscordMessage(text);
    assert.ok(parts.length > 1);
    assert.ok(parts.every((part) => part.length <= 2000));
    for (const part of parts) {
      const markers = part.split('\n').filter((line) => line.trim().startsWith('```'));
      assert.equal(markers.length % 2, 0);
    }
    assert.match(parts[1] ?? '', /^```ts\n/);
    assert.match(parts[0] ?? '', /```$/);
  });
});

describe('n8n responses', () => {
  it('prefers a reply, then approval, then a pollable working status', () => {
    assert.deepEqual(readBotResponse({ reply: ' hello ', thread: 't1', status: 'working' }), {
      type: 'reply',
      text: 'hello',
      thread: 't1',
    });
    assert.deepEqual(readBotResponse({ status: 'needs_approval', thread: 42 }), {
      type: 'needs_approval',
      thread: '42',
    });
    assert.deepEqual(readBotResponse({ status: 'working', thread: 't1' }), { type: 'working', thread: 't1' });
    assert.deepEqual(readBotResponse({ status: 'working' }), { type: 'empty' });
    assert.deepEqual(readBotResponse(null), { type: 'empty' });
  });

  it('polls until five minutes, then stops', () => {
    assert.equal(pollDecision(299_000), 'continue');
    assert.equal(pollDecision(300_000), 'timeout');
  });
});

describe('cooldown', () => {
  it('allows one message per six seconds', () => {
    assert.equal(cooldownReady(undefined, 1_000), true);
    assert.equal(cooldownReady(1_000, 6_999), false);
    assert.equal(cooldownReady(1_000, 7_000), true);
  });

  it('recognises the new-chat message', () => {
    assert.equal(isNewChatCommand('  !new  '), true);
    assert.equal(isNewChatCommand('!New'), false);
    assert.equal(isNewChatCommand('!new please'), false);
  });
});
