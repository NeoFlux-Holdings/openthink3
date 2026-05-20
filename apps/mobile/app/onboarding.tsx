/* Mobile onboarding — what we show when the user opens the app and
 * doesn't have an agent set up yet. Per the user's explicit guidance the
 * app does NOT try to provision a new agent on the phone (CF tokens,
 * Stripe checkout, DNS — all painful on a 6" screen). Instead we hand
 * them to the web with a friendly explanation, and leave the door open
 * for sign-in once they've got an agent live.
 *
 * Reached from the sign-in screen via the "Don't have one yet?" CTA.
 */
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Body,
  Button,
  Card,
  Chip,
  Eyebrow,
  H1,
  Mono,
  Screen,
} from '../src/components/primitives';
import { useTheme } from '../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../src/theme/tokens';

const STEPS = [
  { n: 1, title: 'Open openthink.run on your laptop', body: 'Connecting Cloudflare is a 30-second copy-paste — much easier on a real keyboard.' },
  { n: 2, title: 'Connect your Cloudflare account', body: 'Use Bring-your-own (free) or Hosted ($12 with credits). We never see the token.' },
  { n: 3, title: 'Watch it deploy in ~60 seconds', body: 'D1, R2, KV, DNS, Workers AI — all provisioned automatically.' },
  { n: 4, title: 'Come back here and sign in', body: 'On the agent\'s settings page, tap "Pair a device" to get a code. Type it into the sign-in screen.' },
];

export default function MobileOnboarding() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const openLanding = () =>
    Linking.openURL('https://openthink.run').catch(() => undefined);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.s5,
          paddingTop: insets.top + space.s5,
          paddingBottom: insets.bottom + space.s5,
          gap: space.s5,
        }}
      >
        <View>
          <Eyebrow>welcome</Eyebrow>
          <H1>Your agent, on{'\n'}your Cloudflare.</H1>
        </View>
        <Body style={{ color: colors.ink2 }}>
          OpenThink runs entirely on your own Cloudflare account. Set up takes about ninety
          seconds — but it&apos;s easier on a desktop browser.
        </Body>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {STEPS.map((s, i) => (
            <View
              key={s.n}
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                padding: space.s4,
                gap: space.s4,
                borderBottomColor: i < STEPS.length - 1 ? colors.rule : 'transparent',
                borderBottomWidth: i < STEPS.length - 1 ? 1 : 0,
              }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: colors.brandSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: colors.brand, fontFamily: fontFamily.monoMedium, fontSize: 12 }}>
                  {s.n}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  style={{
                    color: colors.ink,
                    fontFamily: fontFamily.bodyMedium,
                    fontSize: fontSize.body,
                    lineHeight: 20,
                  }}
                >
                  {s.title}
                </Text>
                <Body style={{ color: colors.mute }}>{s.body}</Body>
              </View>
            </View>
          ))}
        </Card>

        <Button kind="brand" size="lg" onPress={openLanding}>
          Open openthink.run ↗
        </Button>

        <View style={{ paddingTop: space.s3, alignItems: 'center', gap: space.s2 }}>
          <Mono>Already have an agent?</Mono>
          <Pressable onPress={() => router.replace('/sign-in')}>
            <Text style={{ color: colors.brand, fontFamily: fontFamily.bodyMedium, fontSize: 13.5 }}>
              Sign in →
            </Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.s2, marginTop: space.s5 }}>
          <Chip kind="default" small leading={<Ionicons name="lock-closed" size={11} color={colors.ink2} />}>
            zero packets to us
          </Chip>
          <Chip kind="default" small leading={<Ionicons name="cash-outline" size={11} color={colors.ink2} />}>
            ~$5/mo CF
          </Chip>
          <Chip kind="default" small leading={<Ionicons name="code-slash-outline" size={11} color={colors.ink2} />}>
            Apache-2.0
          </Chip>
        </View>
      </ScrollView>
    </Screen>
  );
}
