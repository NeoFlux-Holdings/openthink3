/* New task — bottom sheet.
 *
 * Uses the real BottomSheet (drag-to-dismiss, slide-up spring, fading
 * backdrop). Hold-to-talk mic is a v1 stub — long-press fires an example
 * query so the demo flow works; voice transcription is v1.1.
 */
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { BottomSheet } from '../../src/components/BottomSheet';
import { Body, Eyebrow, H2, Mono } from '../../src/components/primitives';
import { confirm as hapticConfirm, tap as hapticTap } from '../../src/lib/haptics';
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
  const { session } = useSession();
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const haloScale = useSharedValue(1);
  const haloOpacity = useSharedValue(0.5);

  useEffect(() => {
    haloScale.value = withRepeat(
      withTiming(1.6, { duration: 2000, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
    haloOpacity.value = withRepeat(
      withTiming(0, { duration: 2000, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
  }, [haloScale, haloOpacity]);

  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: haloScale.value }],
    opacity: haloOpacity.value,
  }));

  const launch = async (text: string) => {
    if (!session || !text.trim()) return;
    hapticConfirm();
    setSending(true);
    try {
      const { threadId } = await sendMessage(session, null, text.trim());
      router.replace(`/threads/${threadId}` as never);
    } catch {
      router.back();
    } finally {
      setSending(false);
    }
  };

  return (
    <BottomSheet onClose={() => router.back()}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Eyebrow>New task</Eyebrow>
        <H2 style={{ marginTop: 4 }}>What do you want done?</H2>

        <View style={{ alignItems: 'center', paddingVertical: space.s7 }}>
          <View style={{ position: 'relative', width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  backgroundColor: colors.brand,
                },
                haloStyle,
              ]}
            />
            <Pressable
              onLongPress={() => {
                hapticConfirm();
                void launch('Hello agent — quick check-in.');
              }}
              onPressIn={hapticTap}
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
          <Mono style={{ marginTop: 2, fontSize: 10, opacity: 0.6 }}>
            voice transcription in v1.1
          </Mono>
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
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask anything — book a meeting, draft a memo, pull a chart…"
            placeholderTextColor={colors.soft}
            multiline
            autoFocus
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
              onPress={() => {
                hapticTap();
                setDraft(s.replace('✦ ', ''));
                setTimeout(() => inputRef.current?.focus(), 16);
              }}
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
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}
