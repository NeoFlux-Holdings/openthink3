/* New task — bottom sheet variant.
 *
 * Big hold-to-talk mic in the middle (with pulsing halo), suggestion pills,
 * and a fallback textarea. Pressing the mic just shows "Listening…" for
 * now — real voice transcription is a v1.1 feature; for v1 we surface the
 * textarea path immediately if the user prefers typing.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Card, Chip, Eyebrow, H2, Mono, Screen } from '../../src/components/primitives';
import { sendMessage } from '../../src/lib/api';
import { useSession } from '../../src/lib/session-store';
import { useTheme } from '../../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../../src/theme/tokens';

const SUGGESTIONS = [
  '✦ Summarize today\'s deep work',
  '✦ Book a 30-min slot with Sarah next week',
  '✦ Draft a polite no for the partnership ask',
  '✦ Pull last week\'s Stripe revenue and chart it',
];

export default function NewTaskSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const haloScale = useRef(new Animated.Value(1)).current;
  const haloOpacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(haloScale, { toValue: 1.6, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(haloScale, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(haloOpacity, { toValue: 0, duration: 2000, useNativeDriver: true }),
          Animated.timing(haloOpacity, { toValue: 0.5, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [haloScale, haloOpacity]);

  const launch = async (text: string) => {
    if (!session || !text.trim()) return;
    setSending(true);
    try {
      const { threadId } = await sendMessage(session, null, text.trim());
      router.replace(`/threads/${threadId}` as any);
    } catch {
      router.back();
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <Pressable
        style={{ flex: 1 }}
        onPress={() => router.back()}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.r5,
            borderTopRightRadius: radius.r5,
            paddingHorizontal: space.s5,
            paddingTop: space.s4,
            paddingBottom: insets.bottom + space.s5,
            maxHeight: '78%',
          }}
        >
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.rule2, alignSelf: 'center', marginBottom: space.s4 }} />
          <Eyebrow>New task</Eyebrow>
          <H2>What do you want done?</H2>

          <View style={{ alignItems: 'center', paddingVertical: space.s7 }}>
            <View style={{ position: 'relative', width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
              <Animated.View
                style={{
                  position: 'absolute',
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  backgroundColor: colors.brand,
                  opacity: haloOpacity,
                  transform: [{ scale: haloScale }],
                }}
              />
              <Pressable
                onLongPress={() => launch('Hello agent — quick check-in.')}
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  backgroundColor: colors.brand,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="mic" color="#FFFFFF" size={36} />
              </Pressable>
            </View>
            <Mono style={{ marginTop: space.s4 }}>Hold to talk · or type below</Mono>
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: space.s2,
              borderColor: colors.rule2,
              borderWidth: 1,
              borderRadius: radius.r3,
              padding: space.s3,
              backgroundColor: colors.bg,
            }}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Ask anything — book a meeting, draft a memo, pull a chart…"
              placeholderTextColor={colors.soft}
              multiline
              style={{
                flex: 1,
                color: colors.ink,
                fontFamily: fontFamily.body,
                fontSize: fontSize.body,
                minHeight: 44,
                paddingTop: 4,
              }}
            />
            <Pressable
              onPress={() => launch(draft)}
              disabled={!draft.trim() || sending}
              style={{
                width: 38,
                height: 38,
                borderRadius: radius.r3,
                backgroundColor: draft.trim() ? colors.brand : colors.surface2,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="arrow-up" color={draft.trim() ? '#FFFFFF' : colors.mute} size={20} />
            </Pressable>
          </View>

          <View style={{ marginTop: space.s4, flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 }}>
            {SUGGESTIONS.map((s) => (
              <Pressable
                key={s}
                onPress={() => setDraft(s.replace('✦ ', ''))}
                style={{
                  paddingHorizontal: space.s3,
                  paddingVertical: space.s2,
                  borderRadius: radius.pill,
                  borderColor: colors.rule2,
                  borderWidth: 1,
                  backgroundColor: colors.surface,
                }}
              >
                <Text style={{ fontFamily: fontFamily.body, fontSize: 12, color: colors.ink2 }}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
