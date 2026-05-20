/* Sign in to your agent.
 *
 * Two paths:
 *   1. Quick paste — type or paste the agent's subdomain (`flannel-arroyo`)
 *      or full host. Browser opens to magic-link auth on the web app, user
 *      copies the short code, pastes it back in.
 *   2. (Future) QR scan — the web "You" page exposes a QR for one-tap pair.
 *
 * Both paths end with a POST to /api/mobile/session/exchange which returns
 * the bearer token + agent name.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Device from 'expo-device';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

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
import { ApiError, exchangeMagicCode } from '../src/lib/api';
import { useSession } from '../src/lib/session-store';
import { extractAgentName, normalizeAgentUrl } from '../src/lib/session';
import { useTheme } from '../src/theme/ThemeContext';
import { fontSize, radius, space, type } from '../src/theme/tokens';

export default function SignIn() {
  const router = useRouter();
  const { signIn } = useSession();
  const { colors } = useTheme();
  const [host, setHost] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'host' | 'code' | 'exchanging'>('host');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Listen for openthink:// deep links — clicking the magic link in the
  // browser email bounces back to the app with `?code=…`, which we use to
  // pre-fill and auto-submit.
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      try {
        const parsed = new URL(url);
        const c = parsed.searchParams.get('code');
        const h = parsed.searchParams.get('host');
        if (c) setCode(c);
        if (h) setHost(h);
        if (c) setStage('code');
      } catch {
        /* ignore */
      }
    });
    void Linking.getInitialURL().then((url) => {
      if (!url) return;
      try {
        const parsed = new URL(url);
        const c = parsed.searchParams.get('code');
        const h = parsed.searchParams.get('host');
        if (c) setCode(c);
        if (h) setHost(h);
        if (c) setStage('code');
      } catch {
        /* ignore */
      }
    });
    return () => sub.remove();
  }, []);

  const launchMagicLink = async () => {
    const url = normalizeAgentUrl(host);
    if (!url) {
      setError('Enter your agent subdomain or full URL.');
      return;
    }
    setError(null);
    setWorking(true);
    try {
      // Hit the agent's magic-link endpoint — opens the web app to a
      // device-confirmation page that issues a code the user can paste back.
      const target = `${url}/mobile/pair?device=${encodeURIComponent(deviceLabel())}`;
      await WebBrowser.openBrowserAsync(target);
      setStage('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open browser.');
    } finally {
      setWorking(false);
    }
  };

  const submitCode = async () => {
    const url = normalizeAgentUrl(host);
    const trimmed = code.trim().toUpperCase();
    if (!url) {
      setError('Set your agent subdomain first.');
      return;
    }
    if (!trimmed) {
      setError('Enter the code from the browser.');
      return;
    }
    setError(null);
    setStage('exchanging');
    try {
      const { token, agentName } = await exchangeMagicCode(url, trimmed, deviceLabel());
      await signIn({ agentUrl: url, token, agentName: agentName || extractAgentName(url) });
      router.replace('/today');
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : (err as Error).message;
      setError(msg || 'Sign-in failed.');
      setStage('code');
    }
  };

  const deviceLabel = () => {
    const make = Device.modelName ?? Device.deviceName ?? 'mobile';
    return `${make} · ${Platform.OS}`;
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.s6, paddingTop: space.s10, gap: space.s5 }}
          keyboardShouldPersistTaps="handled"
        >
          <Eyebrow>Sign in</Eyebrow>
          <H1>Connect to your agent.</H1>
          <Body style={{ marginBottom: space.s4 }}>
            Your agent lives on your Cloudflare account. Paste its handle, confirm in your browser,
            and you&apos;re in.
          </Body>

          <Card style={{ padding: space.s5, gap: space.s4 }}>
            <View>
              <Eyebrow>Agent handle</Eyebrow>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.s2,
                  borderColor: colors.rule2,
                  borderWidth: 1,
                  borderRadius: radius.r3,
                  paddingHorizontal: space.s3,
                  height: 48,
                  marginTop: space.s2,
                  backgroundColor: colors.surface,
                }}
              >
                <TextInput
                  value={host}
                  onChangeText={(t) => {
                    setHost(t);
                    setError(null);
                  }}
                  placeholder="flannel-arroyo"
                  placeholderTextColor={colors.soft}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    flex: 1,
                    fontFamily: type.mono,
                    fontSize: fontSize.bodyLg,
                    color: colors.ink,
                  }}
                />
                <Text style={{ fontFamily: type.mono, color: colors.mute, fontSize: 13 }}>
                  .openthink.run
                </Text>
              </View>
              <Mono style={{ marginTop: space.s2 }}>
                Or a full URL: <Text style={{ color: colors.ink2 }}>https://your-agent.com</Text>
              </Mono>
            </View>

            {stage === 'host' && (
              <Button kind="brand" size="lg" onPress={launchMagicLink} loading={working}>
                Open my agent →
              </Button>
            )}

            {stage !== 'host' && (
              <View style={{ gap: space.s3 }}>
                <View>
                  <Eyebrow>Confirmation code</Eyebrow>
                  <View
                    style={{
                      borderColor: colors.rule2,
                      borderWidth: 1,
                      borderRadius: radius.r3,
                      paddingHorizontal: space.s3,
                      height: 48,
                      marginTop: space.s2,
                      backgroundColor: colors.surface,
                      justifyContent: 'center',
                    }}
                  >
                    <TextInput
                      value={code}
                      onChangeText={(t) => {
                        setCode(t.toUpperCase());
                        setError(null);
                      }}
                      placeholder="6-letter code"
                      placeholderTextColor={colors.soft}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      style={{
                        fontFamily: type.mono,
                        fontSize: 18,
                        letterSpacing: 4,
                        color: colors.ink,
                      }}
                    />
                  </View>
                  <Mono style={{ marginTop: space.s2 }}>
                    Find it on the “Pair a device” page in your browser.
                  </Mono>
                </View>

                <View style={{ flexDirection: 'row', gap: space.s3 }}>
                  <Button kind="ghost" size="lg" onPress={() => setStage('host')} style={{ flex: 1 }}>
                    Back
                  </Button>
                  <Button kind="brand" size="lg" onPress={submitCode} loading={stage === 'exchanging'} style={{ flex: 1 }}>
                    Sign in
                  </Button>
                </View>
              </View>
            )}

            {error && (
              <Chip kind="red" small>
                {error}
              </Chip>
            )}
          </Card>

          <Card soft style={{ padding: space.s5, gap: space.s2 }}>
            <Eyebrow>Don&apos;t have one yet?</Eyebrow>
            <Body>
              The agent platform deploys on Cloudflare in about 90 seconds. Setup is easier on a
              real keyboard — we&apos;ll walk you through it.
            </Body>
            <Pressable
              onPress={() => router.push('/onboarding')}
              style={{
                marginTop: space.s2,
                alignSelf: 'flex-start',
                paddingHorizontal: space.s4,
                paddingVertical: space.s2,
                borderRadius: radius.pill,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.rule2,
              }}
            >
              <Text
                style={{
                  fontFamily: type.bodyMedium,
                  color: colors.ink,
                  fontSize: 13,
                }}
              >
                Show me how →
              </Text>
            </Pressable>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
