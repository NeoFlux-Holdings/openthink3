/* Conversation detail — header bar + working notes pin + msg-user / msg-ag
 * stream + composer at the bottom. Tap an artifact card to push the
 * Browser session screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Body,
  Card,
  Chip,
  Dot,
  Eyebrow,
  Mono,
  Screen,
} from '../../src/components/primitives';
import { LiveDot } from '../../src/components/LiveDot';
import { getConversation, sendMessage, type Conversation, type ConversationMessage } from '../../src/lib/api';
import { useSession } from '../../src/lib/session-store';
import { useTheme } from '../../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../../src/theme/tokens';

const FALLBACK: Conversation = {
  id: 'q3',
  title: 'Q3 launch + customer calls',
  live: true,
  workingNotes: {
    goal: 'Q3 launch + book 3 calls next week.',
    found: '8 tier-2 candidates in CRM · 21 free slots Mon–Fri PM.',
    working: 'drafting launch.md v8 · booking Sarah C. + Derek M. via Calendly.',
    updatedAt: Date.now() - 2000,
  },
  messages: [
    { id: 'm1', role: 'user', text: 'Book 3 customer calls next week from the tier-2 list', time: '9:14' },
    {
      id: 'm2',
      role: 'agent',
      text: "Found 8 candidates in the CRM. I'll start with Sarah Cohen (warm), Derek Mason (cold but high signal), and Priya Vance (Tier 2 archetype). Drafting outreach now.",
      time: '9:15',
      tools: [{ name: 'crm.query' }, { name: 'calendar' }, { name: 'browser' }],
      reasoned: { seconds: 4, tokens: 612, preview: 'Tier-2 customers have the warmest cold-start when the agent shows...' },
    },
  ],
  artifacts: [
    { id: 'a1', type: 'doc', title: 'launch.md', size: '4.2KB' },
    { id: 'a2', type: 'table', title: 'candidates', size: '1.4KB' },
    { id: 'a3', type: 'browser', title: 'calendly.com/derek-m', size: 'live' },
  ],
};

export default function Conversation() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<Conversation>(FALLBACK);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
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

  // After the feed renders, scroll to the bottom so the user lands on the
  // most recent message. Re-fires whenever messages arrive — including
  // optimistic appends from `send()`.
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [data.messages.length]);

  const send = async () => {
    if (!session || !draft.trim()) return;
    const text = draft.trim();
    setSending(true);
    setDraft('');
    // Optimistic append.
    setData((prev) => ({
      ...prev,
      messages: [
        ...prev.messages,
        { id: `local-${Date.now()}`, role: 'user', text, time: nowLabel() },
      ],
    }));
    try {
      await sendMessage(session, data.id, text);
      await load();
    } catch {
      /* swallow — the user will see the local bubble */
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingTop: insets.top + space.s2,
          paddingHorizontal: space.s4,
          paddingBottom: space.s3,
          borderBottomColor: colors.rule,
          borderBottomWidth: 1,
          gap: space.s3,
          backgroundColor: colors.bg,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: fontFamily.display500, fontSize: 16, color: colors.ink }} numberOfLines={1}>
            {data.title}
          </Text>
          {data.live && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <LiveDot kind="coral" size={6} />
              <Mono style={{ color: colors.coralInk }}>thinking</Mono>
            </View>
          )}
        </View>
        <Pressable hitSlop={12}>
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.mute} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 52 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: space.s4, gap: space.s5 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {data.workingNotes && (
            <Card soft style={{ padding: space.s4, gap: space.s2, backgroundColor: colors.brandSoft, borderColor: 'transparent' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Eyebrow style={{ color: colors.brand }}>Working notes</Eyebrow>
                <Mono style={{ color: colors.brand, opacity: 0.6 }}>{formatAge(data.workingNotes.updatedAt)}</Mono>
              </View>
              <Text style={{ color: colors.brandInk, lineHeight: 20, fontFamily: fontFamily.body, fontSize: 13 }}>
                <Text style={{ fontFamily: fontFamily.bodyMedium, color: colors.ink }}>Goal:</Text> {data.workingNotes.goal}{'\n'}
                <Text style={{ fontFamily: fontFamily.bodyMedium, color: colors.ink }}>Found:</Text> {data.workingNotes.found}{'\n'}
                <Text style={{ fontFamily: fontFamily.bodyMedium, color: colors.ink }}>Working:</Text> {data.workingNotes.working}
              </Text>
            </Card>
          )}

          {data.messages.map((m) => (
            <Message key={m.id} message={m} />
          ))}

          {data.artifacts.length > 0 && (
            <View style={{ gap: space.s2 }}>
              <Eyebrow>Artifacts</Eyebrow>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s3 }}>
                {data.artifacts.map((a) => (
                  <Pressable
                    key={a.id}
                    onPress={() => a.type === 'browser' && router.push(`/threads/${data.id}/browser` as any)}
                  >
                    <Card style={{ padding: space.s3, gap: space.s2, width: 180 }}>
                      <View
                        style={{
                          height: 86,
                          backgroundColor: a.type === 'browser' ? colors.coralSoft : colors.surface2,
                          borderRadius: radius.r2,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons
                          name={
                            a.type === 'doc' ? 'document-text-outline' :
                            a.type === 'browser' ? 'globe-outline' :
                            a.type === 'code' ? 'code-slash-outline' :
                            a.type === 'table' ? 'grid-outline' :
                            'image-outline'
                          }
                          size={28}
                          color={a.type === 'browser' ? colors.coral : colors.mute}
                        />
                      </View>
                      <Text style={{ fontFamily: fontFamily.bodyMedium, color: colors.ink, fontSize: 13 }} numberOfLines={1}>
                        {a.title}
                      </Text>
                      <Mono>{a.size}</Mono>
                    </Card>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {data.live && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  borderWidth: 1.5,
                  borderColor: colors.brand,
                  borderTopColor: 'transparent',
                }}
              />
              <Mono style={{ color: colors.mute }}>browsing calendly.com/derek-m · selecting slot</Mono>
            </View>
          )}
        </ScrollView>

        <View
          style={{
            borderTopColor: colors.rule,
            borderTopWidth: 1,
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
              borderRadius: radius.r3,
              backgroundColor: colors.surface2,
            }}
          >
            <Ionicons name="attach-outline" size={20} color={colors.mute} />
          </Pressable>
          <View
            style={{
              flex: 1,
              backgroundColor: colors.surface,
              borderColor: colors.rule2,
              borderWidth: 1,
              borderRadius: radius.r3,
              paddingHorizontal: space.s3,
              minHeight: 38,
              maxHeight: 120,
              justifyContent: 'center',
            }}
          >
            <TextInput
              placeholder="What else? Hold to talk · or type"
              placeholderTextColor={colors.soft}
              value={draft}
              onChangeText={setDraft}
              multiline
              style={{ fontFamily: fontFamily.body, fontSize: fontSize.body, color: colors.ink, paddingVertical: 8 }}
            />
          </View>
          <Pressable
            onPress={send}
            disabled={!draft.trim() || sending}
            style={{
              width: 38,
              height: 38,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.r3,
              backgroundColor: draft.trim() ? colors.brand : colors.surface2,
              opacity: sending ? 0.6 : 1,
            }}
          >
            <Ionicons name="send" size={18} color={draft.trim() ? '#FFFFFF' : colors.mute} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Message({ message }: { message: ConversationMessage }) {
  const { colors } = useTheme();
  if (message.role === 'user') {
    return (
      <View style={{ alignSelf: 'flex-end', maxWidth: '85%' }}>
        <View
          style={{
            backgroundColor: colors.brand2,
            paddingHorizontal: space.s3,
            paddingVertical: space.s2,
            borderRadius: 14,
            borderBottomRightRadius: 4,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontFamily: fontFamily.body, fontSize: fontSize.body, lineHeight: 20 }}>
            {message.text}
          </Text>
        </View>
        <Mono style={{ textAlign: 'right', marginTop: 2 }}>{message.time}</Mono>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap: space.s3 }}>
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
      <View style={{ flex: 1, gap: space.s2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 12.5, color: colors.ink }}>
            flannel-arroyo
          </Text>
          <Mono>{message.time}</Mono>
        </View>
        {message.reasoned && (
          <View style={{ borderLeftWidth: 2, borderLeftColor: colors.rule2, paddingLeft: space.s3 }}>
            <Mono>
              Reasoned for {message.reasoned.seconds}s · {message.reasoned.tokens} tokens
            </Mono>
          </View>
        )}
        {message.tools && message.tools.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {message.tools.map((t) => (
              <Chip key={t.name} kind="default" small>
                {t.name}
              </Chip>
            ))}
          </View>
        )}
        <Body style={{ color: colors.ink2, lineHeight: 22 }}>{message.text}</Body>
      </View>
    </View>
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
