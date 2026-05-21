/* New task — bottom sheet.
 *
 * Layout matches the delta:
 *   "New task" eyebrow → "What do you want done?" big question
 *   96px glowing mic button + "Hold to talk · or type below"
 *   Text input
 *   Suggested chips row (4 short prompts with sparkle icons)
 *
 * Hold-to-talk is a v1 stub — long-press fires an example query so the
 * flow works end-to-end. Voice transcription lands in v1.1.
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
import { Mono } from '../../src/components/primitives';
import { confirm as hapticConfirm, tap as hapticTap } from '../../src/lib/haptics';
import { sendMessage } from '../../src/lib/api';
import { useSession } from '../../src/lib/session-store';
import { useTheme } from '../../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../../src/theme/tokens';

const SUGGESTIONS = [
  'Plan my day',
  'Summarize Slack',
  'Book a meeting',
  'Triage inbox',
];

export default function NewTaskSheet() {
  const router = useRouter();
  const { session } = useSession();
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const haloScale = useSharedValue(1);
  const haloOpacity = useSharedValue(0.45);

  useEffect(() => {
    haloScale.value = withRepeat(
      withTiming(1.45, { duration: 1800, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
    haloOpacity.value = withRepeat(
      withTiming(0, { duration: 1800, easing: Easing.out(Easing.ease) }),
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
        <Mono>New task</Mono>
        <Text
          style={{
            marginTop: 4,
            fontFamily: fontFamily.display,
            fontSize: 22,
            letterSpacing: -0.3,
            color: colors.ink,
          }}
        >
          What do you want done?
        </Text>

        <View style={{ alignItems: 'center', paddingVertical: space.s7 }}>
          <View
            style={{
              position: 'relative',
              width: 96,
              height: 96,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
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
                shadowColor: colors.brand,
                shadowOpacity: 0.45,
                shadowRadius: 30,
                shadowOffset: { width: 0, height: 14 },
                elevation: 14,
              }}
            >
              <Ionicons name="flash" color="#FFFFFF" size={36} />
            </Pressable>
          </View>
          <Text
            style={{
              marginTop: space.s4,
              fontFamily: fontFamily.body,
              fontSize: 14,
              color: colors.mute,
              textAlign: 'center',
            }}
          >
            Hold to talk
          </Text>
          <Mono style={{ marginTop: 2, fontSize: 11.5 }}>or type below</Mono>
        </View>

        <View
          style={{
            backgroundColor: colors.surface2,
            borderColor: colors.rule,
            borderWidth: 1,
            borderRadius: radius.r4,
            paddingHorizontal: space.s3,
            paddingVertical: space.s3,
            minHeight: 80,
          }}
        >
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            placeholder="Plan my Q3 launch…"
            placeholderTextColor={colors.soft}
            multiline
            style={{
              color: colors.ink,
              fontFamily: fontFamily.body,
              fontSize: fontSize.bodyLg,
              minHeight: 56,
              textAlignVertical: 'top',
            }}
          />
        </View>

        <View style={{ marginTop: space.s4 }}>
          <Mono style={{ fontSize: 11, letterSpacing: 0.06, textTransform: 'uppercase' }}>
            Suggested
          </Mono>
          <View style={{ marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {SUGGESTIONS.map((s) => (
              <Pressable
                key={s}
                onPress={() => {
                  hapticTap();
                  setDraft(s);
                  setTimeout(() => inputRef.current?.focus(), 16);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  paddingHorizontal: 11,
                  paddingVertical: 8,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surface2,
                  borderColor: colors.rule,
                  borderWidth: 1,
                }}
              >
                <Ionicons name="sparkles" size={11} color={colors.brand} />
                <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 13, color: colors.ink2 }}>
                  {s}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Hidden submit — surface via send button if draft non-empty */}
        {draft.trim().length > 0 && (
          <Pressable
            onPress={() => launch(draft)}
            disabled={sending}
            style={{
              marginTop: space.s4,
              backgroundColor: colors.brand,
              paddingVertical: 13,
              borderRadius: radius.r3,
              alignItems: 'center',
              opacity: sending ? 0.7 : 1,
            }}
          >
            <Text
              style={{ color: '#FFFFFF', fontFamily: fontFamily.bodyMedium, fontSize: 14.5 }}
            >
              Send to agent →
            </Text>
          </Pressable>
        )}
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}
