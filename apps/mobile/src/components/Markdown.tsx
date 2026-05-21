/* Markdown — chat-message rich text on mobile.
 *
 * Same parser as the web Markdown component (apps/platform/src/web/shell/
 * Markdown.tsx). We don't import it because the worker package is built
 * as a separate target — duplicating ~100 lines of pure-function parser
 * keeps the dependency graph clean.
 *
 * Renders to React Native <Text>/<View>. No external markdown dep
 * (react-native-markdown-display brings rest of the world). All styles
 * pull from the existing design tokens so light/dark works without an
 * override block.
 *
 * Subset:
 *   paragraphs, **bold**, *italic*, `inline code`,
 *   ```code blocks``` with a copy button,
 *   bullet (-, *) + numbered lists, headings 1-3, links [text](url).
 *
 * Streaming-friendly: an unterminated trailing code fence renders as a
 * partial block so the user sees output mid-stream.
 */
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';

import { useTheme } from '../theme/ThemeContext';
import { radius, space, type as fontFamily } from '../theme/tokens';
import { confirm as hapticConfirm } from '../lib/haptics';

interface Props {
  source: string;
  /** Optional override of the body text color. Default colors.ink2. */
  textColor?: string;
}

export function Markdown({ source, textColor }: Props) {
  const blocks = parseMarkdown(source);
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} textColor={textColor} />
      ))}
    </View>
  );
}

function Block({ block, textColor }: { block: MdBlock; textColor?: string }) {
  const { colors } = useTheme();
  const ink2 = textColor ?? colors.ink2;
  switch (block.type) {
    case 'paragraph':
      return (
        <Text
          style={{
            fontFamily: fontFamily.body,
            fontSize: 14.5,
            lineHeight: 22,
            color: ink2,
          }}
        >
          {renderInline(block.text, ink2)}
        </Text>
      );
    case 'heading': {
      const size = block.level === 1 ? 18 : block.level === 2 ? 16 : 15;
      return (
        <Text
          style={{
            fontFamily: fontFamily.bodyMedium,
            fontSize: size,
            color: colors.ink,
            letterSpacing: -0.2,
            marginTop: 6,
            marginBottom: 2,
          }}
        >
          {renderInline(block.text, colors.ink)}
        </Text>
      );
    }
    case 'code':
      return <CodeBlock code={block.code} language={block.language} incomplete={block.incomplete} />;
    case 'quote':
      return (
        <View
          style={{
            paddingLeft: 10,
            paddingVertical: 4,
            borderLeftWidth: 3,
            borderLeftColor: colors.ruleStrong,
          }}
        >
          <Text
            style={{
              fontFamily: fontFamily.body,
              fontSize: 14,
              color: colors.mute,
              fontStyle: 'italic',
              lineHeight: 20,
            }}
          >
            {renderInline(block.text, colors.mute)}
          </Text>
        </View>
      );
    case 'list':
      return (
        <View style={{ gap: 4, paddingLeft: 6 }}>
          {block.items.map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Text
                style={{
                  fontFamily: block.ordered ? fontFamily.mono : fontFamily.body,
                  fontSize: 14,
                  color: colors.mute,
                  minWidth: 16,
                  lineHeight: 22,
                }}
              >
                {block.ordered ? `${i + 1}.` : '•'}
              </Text>
              <Text
                style={{
                  flex: 1,
                  fontFamily: fontFamily.body,
                  fontSize: 14.5,
                  lineHeight: 22,
                  color: ink2,
                }}
              >
                {renderInline(item, ink2)}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'hr':
      return (
        <View
          style={{
            height: 1,
            backgroundColor: colors.rule,
            marginVertical: 6,
          }}
        />
      );
  }
}

function CodeBlock({
  code,
  language,
  incomplete,
}: {
  code: string;
  language?: string;
  incomplete?: boolean;
}) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    hapticConfirm();
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <View
      style={{
        borderRadius: radius.r3,
        overflow: 'hidden',
        backgroundColor: '#0E0F12',
        borderWidth: 1,
        borderColor: colors.rule,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: space.s3,
          paddingVertical: 6,
          backgroundColor: 'rgba(255,255,255,0.04)',
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255,255,255,0.08)',
        }}
      >
        <Text
          style={{
            fontFamily: fontFamily.monoMedium,
            fontSize: 10.5,
            letterSpacing: 0.05,
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.55)',
          }}
        >
          {language || 'text'}
        </Text>
        <Pressable
          onPress={() => void onCopy()}
          hitSlop={8}
          style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 4,
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
          }}
        >
          <Text
            style={{
              fontFamily: fontFamily.mono,
              fontSize: 10.5,
              color: 'rgba(255,255,255,0.75)',
            }}
          >
            {copied ? '✓ copied' : 'copy'}
          </Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ padding: space.s3 }}
      >
        <Text
          style={{
            fontFamily: fontFamily.mono,
            fontSize: 12,
            lineHeight: 19,
            color: 'rgba(255,255,255,0.86)',
          }}
        >
          {code || (incomplete ? '…' : '')}
        </Text>
      </ScrollView>
      {incomplete && (
        <View
          style={{
            height: 1,
            backgroundColor: colors.brand,
            opacity: 0.6,
          }}
        />
      )}
    </View>
  );
}

/* ---------- inline ---------- */

function renderInline(text: string, ink: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  let runStart = 0;
  const flushPlain = (until: number) => {
    if (until > runStart) out.push(text.slice(runStart, until));
  };
  while (i < text.length) {
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flushPlain(i);
        out.push(
          <Text
            key={out.length}
            style={{
              fontFamily: fontFamily.mono,
              fontSize: 12.5,
              color: ink,
              backgroundColor: 'rgba(127,127,127,0.12)',
            }}
          >
            {' '}{text.slice(i + 1, end)}{' '}
          </Text>,
        );
        i = end + 1;
        runStart = i;
        continue;
      }
    }
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i) {
        flushPlain(i);
        out.push(
          <Text key={out.length} style={{ fontFamily: fontFamily.bodyMedium, color: ink }}>
            {renderInline(text.slice(i + 2, end), ink)}
          </Text>,
        );
        i = end + 2;
        runStart = i;
        continue;
      }
    }
    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i && text[end + 1] !== '*') {
        flushPlain(i);
        out.push(
          <Text key={out.length} style={{ fontStyle: 'italic' }}>
            {renderInline(text.slice(i + 1, end), ink)}
          </Text>,
        );
        i = end + 1;
        runStart = i;
        continue;
      }
    }
    if (text[i] === '[') {
      const close = text.indexOf(']', i + 1);
      if (close > i && text[close + 1] === '(') {
        const urlEnd = text.indexOf(')', close + 2);
        if (urlEnd > close) {
          flushPlain(i);
          const linkText = text.slice(i + 1, close);
          // We don't open URLs here — the parent message could have a
          // long-press handler that opens the URL externally. Keep it
          // visually distinct via brand color underline.
          out.push(
            <Text
              key={out.length}
              style={{
                color: '#F38020',
                textDecorationLine: 'underline',
              }}
            >
              {linkText}
            </Text>,
          );
          i = urlEnd + 1;
          runStart = i;
          continue;
        }
      }
    }
    i++;
  }
  flushPlain(text.length);
  return out;
}

/* ---------- parse ---------- */

type MdBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'code'; language?: string; code: string; incomplete?: boolean }
  | { type: 'quote'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'hr' };

function parseMarkdown(source: string): MdBlock[] {
  const out: MdBlock[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) { i++; continue; }
    const fence = /^```(\w+)?\s*$/.exec(line);
    if (fence) {
      const language = fence[1];
      const codeLines: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        if (/^```\s*$/.test(cur)) { closed = true; i++; break; }
        codeLines.push(cur);
        i++;
      }
      out.push({ type: 'code', language, code: codeLines.join('\n'), incomplete: !closed });
      continue;
    }
    if (/^[-*_]{3,}\s*$/.test(line)) { out.push({ type: 'hr' }); i++; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length as 1 | 2 | 3;
      out.push({ type: 'heading', level, text: h[2]!.trim() });
      i++; continue;
    }
    if (line.startsWith('>')) {
      const ql: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
        ql.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      out.push({ type: 'quote', text: ql.join(' ') });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const ord = /^(\d+)\.\s+(.*)$/.exec(line);
    if (bullet || ord) {
      const ordered = !!ord;
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        const b = /^[-*]\s+(.*)$/.exec(cur);
        const o = /^(\d+)\.\s+(.*)$/.exec(cur);
        const m = ordered ? o : b;
        if (!m) break;
        items.push(m[ordered ? 2 : 1]!.trim());
        i++;
      }
      out.push({ type: 'list', ordered, items });
      continue;
    }
    const pLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (!cur.trim()) break;
      if (/^(#{1,3})\s+/.test(cur) || /^```/.test(cur) || /^[-*]\s+/.test(cur) || /^\d+\.\s+/.test(cur) || cur.startsWith('>')) break;
      pLines.push(cur);
      i++;
    }
    out.push({ type: 'paragraph', text: pLines.join(' ') });
  }
  return out;
}
