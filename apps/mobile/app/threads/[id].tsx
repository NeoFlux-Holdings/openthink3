/* Conversation detail — chat thread + canvas view, switched via Segmented.
 *
 * Layout:
 *   Top nav: back chevron + thread title + share/more
 *   Segmented control: Chat (default) | Canvas (count badge)
 *   Body:
 *     Chat → working notes pin · message bubbles · agent reply with
 *            tool chips + token count · live status pill · suggested chips
 *     Canvas → artifact cards (full-width, type-specific mini previews)
 *   Composer pinned at bottom (KeyboardAvoidingView)
 *
 * Streaming auto-scroll: digest of {message text lengths} flips when tokens
 * arrive, scrolling to the bottom — but only if the user hasn't scrolled
 * up. If they have, we surface a "New message" pill instead of yanking
 * them back. Long-press a message to copy.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

import {
  Body,
  Card,
  Chip,
  Eyebrow,
  Mono,
  Screen,
} from '../../src/components/primitives';
import { LiveDot } from '../../src/components/LiveDot';
import { MiniBrowserThumb } from '../../src/components/MiniBrowserThumb';
import { Segmented } from '../../src/components/Segmented';
import { confirm as hapticConfirm, success as hapticSuccess, tap as hapticTap } from '../../src/lib/haptics';
import { getConversation, sendMessage, type Conversation, type ConversationMessage } from '../../src/lib/api';
import { useSession } from '../../src/lib/session-store';
import { useTheme } from '../../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../../src/theme/tokens';

const FALLBACK: Conversation = {
  id: 'q3',
  title: 'Q3 launch plan',
  live: true,
  workingNotes: {
    goal: 'Q3 launch + book 3 calls next week.',
    found: '8 tier-2 candidates in CRM · 21 free slots Mon–Fri PM.',
    working: 'drafting launch.md v8 · booking Sarah C. + Derek M. via Calendly.',
    updatedAt: Date.now() - 2000,
  },
  messages: [
    { id: 'm1', role: 'user', text: 'Help me plan Q3 launch. Book 3 customer calls this week.', time: '9:14' },
    {
      id: 'm2',
      role: 'agent',
      text: "Drafted `launch.md` with audience, risks, candidate list. Queried CRM — **8 tier-2 candidates**. Booked Sarah Cohen (Thu 2pm) + Derek Mason (Fri 11am). Drafting outreach for Priya.",
      time: '9:15',
      tools: [{ name: 'crm.query' }, { name: 'calendar.read' }, { name: 'doc.edit' }],
      reasoned: { seconds: 6, tokens: 2810, preview: 'Two parallel tracks — strategic + tactical.' },
    },
  ],
  artifacts: [
    { id: 'a1', type: 'browser', title: 'calendly.com/derek-m', size: 'live · 4.2 fps' },
    { id: 'a2', type: 'doc', title: 'launch.md', size: 'v8 · 2.4 KB' },
    { id: 'a3', type: 'table', title: 'Q3 candidate calls', size: '8 rows' },
  ],
};

type Mode = 'chat' | 'canvas';

export default function Conversation() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<Conversation>(FALLBACK);
  const [mode, setMode] = useState<Mode>('chat');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const load = useCallback(async () => {
    if (!session || !id) return;
    try {
      const c = await getConversation(session, id);
      setData(c);
    } catch {
      /* fallback */
    }
  }, [id, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Digest changes when text length grows — catches token streaming.
  const feedSignature = data.messages.map((m) => m.text.length).join(',');

  useEffect(() => {
    if (mode !== 'chat') return;
    if (!atBottom) {
      setHasNew(true);
      return;
    }
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [feedSignature, atBottom, mode]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);
    const wasAtBottom = atBottom;
    const isAtBottom = distanceFromBottom < 80;
    if (wasAtBottom !== isAtBottom) setAtBottom(isAtBottom);
    if (isAtBottom && hasNew) setHasNew(false);
  };

  const copyText = async (text: string) => {
    hapticTap();
    try {
      await Clipboard.setStringAsync(text);
    } catch { /* clipboard unavailable */ }
  };

  const shareThread = async () => {
    hapticTap();
    try {
      const url = session ? `${session.agentUrl}/#/shell?thread=${encodeURIComponent(data.id)}` : '';
      await Share.share({ message: url ? `${data.title}\n${url}` : data.title, url });
    } catch { /* user canceled */ }
  };

  const send = async () => {
    if (!session || !draft.trim()) return;
    const text = draft.trim();
    hapticConfirm();
    setSending(true);
    setDraft('');
    setAtBottom(true);
    setData((prev) => ({
      ...prev,
      messages: [
        ...prev.messages,
        { id: `local-${Date.now()}`, role: 'user', text, time: nowLabel() },
      ],
    }));
    try {
      await sendMessage(session, data.id, text);
      hapticSuccess();
      await load();
    } catch { /* swallow */ }
    finally {
      setSending(false);
    }
  };

  return (
    <Screen>
      {/* Nav strip */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingTop: insets.top + 6,
          paddingHorizontal: space.s2,
          paddingBottom: space.s2,
          borderBottomColor: colors.rule,
          borderBottomWidth: 0.5,
          gap: space.s2,
          backgroundColor: colors.bg,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 1, paddingVertical: 6, paddingHorizontal: 4 }}
        >
          <Ionicons name="chevron-back" size={22} color={colors.brand} />
          <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 15, color: colors.brand }}>
            Today
          </Text>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
          {data.live && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <LiveDot kind="coral" size={6} />
              <Mono style={{ fontSize: 11.5, color: colors.coralInk }}>flannel-arroyo</Mono>
            </View>
          )}
          <Text
            style={{
              fontFamily: fontFamily.display500,
              fontSize: 15,
              color: colors.ink,
              letterSpacing: -0.1,
            }}
            numberOfLines={1}
          >
            {data.title}
          </Text>
        </View>
        <Pressable
          hitSlop={12}
          onPress={() => void shareThread()}
          style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="share-outline" size={20} color={colors.mute} />
        </Pressable>
      </View>

      {/* Segmented control */}
      <View style={{ paddingHorizontal: space.s4, paddingTop: space.s2, paddingBottom: space.s1 }}>
        <Segmented<Mode>
          options={[
            { value: 'chat', label: 'Chat' },
            { value: 'canvas', label: 'Canvas', badge: data.artifacts.length },
          ]}
          value={mode}
          onChange={(next) => {
            hapticTap();
            setMode(next);
          }}
        />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 96 : 0}
      >
        {mode === 'chat' ? (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{ padding: space.s4, gap: space.s4 }}
            keyboardShouldPersistTaps="handled"
            onScroll={onScroll}
            scrollEventThrottle={16}
            onContentSizeChange={() => {
              if (atBottom) scrollRef.current?.scrollToEnd({ animated: false });
            }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
            }
          >
            {data.workingNotes && (
              <View
                style={{
                  padding: space.s3,
                  borderRadius: radius.r3,
                  backgroundColor: colors.brandSoft,
                  borderColor: colors.brandSoft2,
                  borderWidth: 1,
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Eyebrow style={{ color: colors.brand }}>Working notes</Eyebrow>
                  <Mono style={{ color: colors.brand, opacity: 0.6 }}>
                    {formatAge(data.workingNotes.updatedAt)}
                  </Mono>
                </View>
                <Text style={{ color: colors.ink2, lineHeight: 20, fontFamily: fontFamily.body, fontSize: 12.5 }}>
                  <Text style={{ fontFamily: fontFamily.bodyMedium, color: colors.ink }}>Goal:</Text> {data.workingNotes.goal}{'\n'}
                  <Text style={{ fontFamily: fontFamily.bodyMedium, color: colors.ink }}>Found:</Text> {data.workingNotes.found}
                </Text>
              </View>
            )}

            {data.messages.map((m) => (
              <Message key={m.id} message={m} onLongPress={() => void copyText(m.text)} />
            ))}

            {/* Inline approval card — tap to review */}
            <Pressable onPress={() => router.push({ pathname: '/sheets/approval', params: { id: 'a1' } })}>
              <View
                style={{
                  backgroundColor: colors.coralSoft,
                  borderRadius: radius.r4,
                  padding: space.s3,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.s3,
                }}
              >
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 9,
                    backgroundColor: colors.coral,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="mail-outline" size={14} color="#FFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontFamily: fontFamily.bodyMedium, fontSize: 13.5, color: colors.coralInk }}
                  >
                    Approval needed
                  </Text>
                  <Mono style={{ color: colors.coralInk, opacity: 0.7, marginTop: 1 }}>
                    tap to review draft email to Priya
                  </Mono>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.coralInk} />
              </View>
            </Pressable>

            {data.live && (
              <View style={{ flexDirection: 'row', gap: space.s3, alignItems: 'flex-start' }}>
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    backgroundColor: colors.ink,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: colors.bg, fontFamily: fontFamily.bodyMedium, fontSize: 12 }}>f</Text>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    backgroundColor: colors.surface2,
                    borderColor: colors.rule,
                    borderWidth: 1,
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: radius.pill,
                    alignSelf: 'flex-start',
                  }}
                >
                  <View
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 5,
                      borderWidth: 1.5,
                      borderColor: colors.ruleStrong,
                      borderTopColor: colors.brand,
                    }}
                  />
                  <Mono style={{ color: colors.mute, fontSize: 12 }}>browsing calendly.com</Mono>
                </View>
              </View>
            )}

            {/* Suggested follow-ups */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {['Why these three?', 'Show launch brief', 'Draft Slack post'].map((s) => (
                <Pressable
                  key={s}
                  style={{
                    paddingHorizontal: 11,
                    paddingVertical: 7,
                    borderRadius: radius.pill,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.rule2,
                  }}
                  onPress={() => setDraft(s)}
                >
                  <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 12.5, color: colors.ink2 }}>
                    {s}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : (
          <CanvasView
            artifacts={data.artifacts}
            threadId={data.id}
            onOpenBrowser={(artifactId) =>
              router.push(`/browser/${data.id}?artifact=${encodeURIComponent(artifactId)}` as never)
            }
          />
        )}

        {hasNew && !atBottom && mode === 'chat' && (
          <Pressable
            onPress={() => {
              hapticTap();
              setAtBottom(true);
              setHasNew(false);
              scrollRef.current?.scrollToEnd({ animated: true });
            }}
            style={{
              position: 'absolute',
              alignSelf: 'center',
              bottom: 92,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: colors.ink,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              shadowColor: '#000',
              shadowOpacity: 0.18,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 },
              elevation: 6,
            }}
          >
            <Ionicons name="arrow-down" size={14} color={colors.bg} />
            <Text style={{ color: colors.bg, fontFamily: fontFamily.bodyMedium, fontSize: 12.5 }}>
              New message
            </Text>
          </Pressable>
        )}

        {/* Composer */}
        <View
          style={{
            borderTopColor: colors.rule,
            borderTopWidth: 0.5,
            padding: space.s3,
            paddingBottom: insets.bottom > 0 ? insets.bottom + space.s2 : space.s4,
            backgroundColor: colors.bg,
            flexDirection: 'row',
            gap: space.s2,
            alignItems: 'flex-end',
          }}
        >
          <Pressable
            style={{
              width: 38,
              height: 38,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 19,
              backgroundColor: colors.surface,
              borderColor: colors.rule,
              borderWidth: 1,
            }}
          >
            <Ionicons name="attach-outline" size={18} color={colors.mute} />
          </Pressable>
          <View
            style={{
              flex: 1,
              backgroundColor: colors.surface,
              borderColor: colors.rule,
              borderWidth: 1,
              borderRadius: 22,
              paddingHorizontal: space.s3,
              minHeight: 40,
              maxHeight: 120,
              justifyContent: 'center',
            }}
          >
            <TextInput
              placeholder="Reply or hold to talk"
              placeholderTextColor={colors.soft}
              value={draft}
              onChangeText={setDraft}
              multiline
              style={{
                fontFamily: fontFamily.body,
                fontSize: fontSize.bodyLg,
                color: colors.ink,
                paddingVertical: 8,
              }}
            />
          </View>
          <Pressable
            onPress={send}
            disabled={!draft.trim() || sending}
            style={{
              width: 40,
              height: 40,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 20,
              backgroundColor: draft.trim() ? colors.brand : colors.surface2,
              opacity: sending ? 0.6 : 1,
            }}
          >
            <Ionicons name="send" size={16} color={draft.trim() ? '#FFFFFF' : colors.mute} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/* ----- Subviews ----- */

function Message({
  message,
  onLongPress,
}: {
  message: ConversationMessage;
  onLongPress?: () => void;
}) {
  const { colors } = useTheme();
  if (message.role === 'user') {
    return (
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={350}
        style={{ alignSelf: 'flex-end', maxWidth: '85%' }}
      >
        <View
          style={{
            backgroundColor: colors.brand2,
            paddingHorizontal: 13,
            paddingVertical: 9,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            borderBottomLeftRadius: 16,
            borderBottomRightRadius: 4,
          }}
        >
          <Text
            style={{
              color: '#FFFFFF',
              fontFamily: fontFamily.body,
              fontSize: 14.5,
              lineHeight: 20,
            }}
          >
            {message.text}
          </Text>
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={350}
      style={{ flexDirection: 'row', gap: 10 }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          backgroundColor: colors.ink,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 2,
        }}
      >
        <Text style={{ color: colors.bg, fontFamily: fontFamily.bodyMedium, fontSize: 12 }}>f</Text>
      </View>
      <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
        <Mono style={{ fontSize: 11.5 }}>
          flannel-arroyo
          {message.reasoned && ` · reasoned ${message.reasoned.seconds}s · ${message.reasoned.tokens.toLocaleString()} tokens`}
        </Mono>
        {message.tools && message.tools.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
            {message.tools.map((t) => (
              <View
                key={t.name}
                style={{
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  backgroundColor: colors.surface2,
                  borderColor: colors.rule,
                  borderWidth: 1,
                  borderRadius: 4,
                }}
              >
                <Text
                  style={{ fontFamily: fontFamily.mono, fontSize: 10.5, color: colors.ink2 }}
                >
                  {t.name}
                </Text>
              </View>
            ))}
          </View>
        )}
        <Body style={{ color: colors.ink2, lineHeight: 22 }}>{message.text}</Body>
      </View>
    </Pressable>
  );
}

function CanvasView({
  artifacts,
  onOpenBrowser,
}: {
  artifacts: Conversation['artifacts'];
  threadId: string;
  onOpenBrowser: (artifactId: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView contentContainerStyle={{ padding: space.s4, gap: space.s3 }}>
      <Eyebrow>{artifacts.length} artifact{artifacts.length === 1 ? '' : 's'}</Eyebrow>
      {artifacts.map((a) => (
        <Pressable
          key={a.id}
          onPress={() => a.type === 'browser' && onOpenBrowser(a.id)}
        >
          <Card style={{ padding: 0, overflow: 'hidden', borderRadius: radius.r4 }}>
            <View
              style={{
                height: 160,
                backgroundColor: colors.bg2,
                overflow: 'hidden',
              }}
            >
              {a.type === 'browser' ? (
                <MiniBrowserThumb />
              ) : a.type === 'doc' ? (
                <View style={{ padding: 24 }}>
                  <View style={{ height: 6, width: '50%', backgroundColor: colors.ink3, borderRadius: 2, marginBottom: 6 }} />
                  {[100, 85, 70, 90, 55].map((w, i) => (
                    <View
                      key={i}
                      style={{
                        height: 4,
                        width: `${w}%`,
                        backgroundColor: colors.ruleStrong,
                        borderRadius: 2,
                        marginBottom: 4,
                      }}
                    />
                  ))}
                </View>
              ) : a.type === 'table' ? (
                <View style={{ padding: 14 }}>
                  {[1, 2, 3, 4, 5, 6].map((j) => (
                    <View
                      key={j}
                      style={{
                        flexDirection: 'row',
                        gap: 6,
                        paddingVertical: 4,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.rule,
                      }}
                    >
                      <View style={{ flex: 1, height: 4, backgroundColor: colors.ruleStrong, borderRadius: 2 }} />
                      <View style={{ flex: 1, height: 4, backgroundColor: colors.ruleStrong, borderRadius: 2 }} />
                      <View style={{ flex: 0.6, height: 4, backgroundColor: colors.ruleStrong, borderRadius: 2 }} />
                    </View>
                  ))}
                </View>
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="cube-outline" size={36} color={colors.soft} />
                </View>
              )}
            </View>
            <View
              style={{
                flexDirection: 'row',
                paddingHorizontal: 14,
                paddingVertical: 10,
                alignItems: 'center',
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{ fontFamily: fontFamily.bodyMedium, fontSize: 13.5, color: colors.ink }}
                  numberOfLines={1}
                >
                  {a.title}
                </Text>
                <Mono style={{ marginTop: 1, fontSize: 11.5 }}>{a.size}</Mono>
              </View>
              <Ionicons name="chevron-forward" size={14} color={colors.soft} />
            </View>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function formatAge(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

function nowLabel() {
  const d = new Date();
  return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
}
