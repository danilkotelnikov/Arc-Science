// Unit tests of lib/promptpurge.mjs
//   node test/promptpurge.test.mjs
import assert from 'node:assert/strict';
import { sanitizePrompt, sanitizePayload } from '../lib/promptpurge.mjs';

let bad = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    bad++;
    console.error(`FAIL ${name} :: ${err.message}`);
  }
}

test('prompt text: command rewrite', () => {
  const input = 'How do I run dsh plugin list?';
  const out = sanitizePrompt(input);
  assert.equal(out, 'How do I run arc plugin list?');
});

test('prompt text: brand and logo rewrite', () => {
  const input = 'DeepSeek Harness is powered by whale graphics';
  const out = sanitizePrompt(input);
  assert.equal(out, 'Arc Harness is powered by cube graphics');
});

test('prompt text: paths and environment variables', () => {
  const input = 'Config lives in ~/.dsh and check $DSH_HOME';
  const out = sanitizePrompt(input);
  assert.equal(out, 'Config lives in ~/.arc and check $ARC_HOME');
});

test('prompt text: package names', () => {
  const input = 'Install @deepseek-ai/dsh-chat and dsh-theme-pair';
  const out = sanitizePrompt(input);
  assert.equal(out, 'Install @arc-harness/arc-chat and arc-theme');
});

test('prompt text: preserves valid model names', () => {
  const input = 'Use deepseek-chat, deepseek-reasoner, or deepseek/deepseek-r1 for reasoning';
  const out = sanitizePrompt(input);
  assert.equal(out, 'Use deepseek-chat, deepseek-reasoner, or deepseek/deepseek-r1 for reasoning');
});

test('prompt text: word boundaries prevent substring corruption', () => {
  const input = 'handshake oldShape dshow spreadsheetml';
  const out = sanitizePrompt(input);
  assert.equal(out, 'handshake oldShape dshow spreadsheetml');
});

test('prompt text: mixed language support', () => {
  const input = 'Запусти dsh команду и настрой DeepSeek Harness';
  const out = sanitizePrompt(input);
  assert.equal(out, 'Запусти arc команду и настрой Arc Harness');
});

test('payload: OpenAI chat completions messages', () => {
  const payload = {
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: 'You are an agent in DeepSeek Harness.' },
      { role: 'user', content: 'Run dsh web and read ~/.dsh/config.json' }
    ],
    temperature: 0.7
  };
  const out = sanitizePayload(payload);
  assert.equal(out.model, 'deepseek-chat');
  assert.equal(out.messages[0].content, 'You are an agent in Arc Harness.');
  assert.equal(out.messages[1].content, 'Run arc web and read ~/.arc/config.json');
  assert.equal(out.temperature, 0.7);
});

test('payload: multipart text content', () => {
  const payload = {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this dsh log' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,123' } }
        ]
      }
    ]
  };
  const out = sanitizePayload(payload);
  assert.equal(out.messages[0].content[0].text, 'Analyze this arc log');
});

test('payload: Anthropic system string and tool arguments', () => {
  const payload = {
    system: 'Welcome to DeepSeek Harness dsh environment',
    messages: [
      {
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_1',
            function: {
              name: 'run_command',
              arguments: JSON.stringify({ command: 'dsh serve --profile web' })
            }
          }
        ]
      }
    ]
  };
  const out = sanitizePayload(payload);
  assert.equal(out.system, 'Welcome to Arc Harness arc environment');
  const args = JSON.parse(out.messages[0].tool_calls[0].function.arguments);
  assert.equal(args.command, 'arc serve --profile web');
});

if (bad > 0) {
  process.exitCode = 1;
}
