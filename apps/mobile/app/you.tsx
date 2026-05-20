/* You — profile + settings + theme + sign-out. */
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

import { Avatar, Body, Card, Chip, Eyebrow, H1, Mono, Screen } from '../src/components/primitives';
import { TabBar, TAB_BAR_HEIGHT } from '../src/components/TabBar';
import { useSession } from '../src/lib/session-store';
import { useTheme } from '../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../src/theme/tokens';

export default function You() {
  const router = useRouter();
  const { session, signOut } = useSession();
  const { theme, setTheme, colors } = useTheme();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.s5,
          paddingTop: space.s8,
          paddingBottom: TAB_BAR_HEIGHT + space.s5,
          gap: space.s5,
        }}
      >
        <H1>You</H1>

        <Card style={{ padding: space.s5, flexDirection: 'row', alignItems: 'center', gap: space.s4 }}>
          <Avatar name={session?.agentName ?? 'a'} size={56} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: fontFamily.display500, fontSize: fontSize.h3, color: colors.ink }}>
              {session?.agentName ?? 'agent'}
            </Text>
            <Mono style={{ color: colors.soft }}>{session?.agentUrl.replace(/^https?:\/\//, '')}</Mono>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
              <Chip kind="green" small>
                ● live
              </Chip>
              <Chip kind="default" small>
                free tier
              </Chip>
            </View>
          </View>
        </Card>

        <Section title="Spend">
          <Card style={{ padding: space.s4, gap: space.s3 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Mono style={{ color: colors.mute }}>this month</Mono>
              <Text style={{ fontFamily: fontFamily.display500, fontSize: fontSize.h2, color: colors.ink }}>$4.17</Text>
            </View>
            <View style={{ height: 8, backgroundColor: colors.surface2, borderRadius: radius.pill, overflow: 'hidden' }}>
              <View style={{ width: '42%', height: '100%', backgroundColor: colors.brand }} />
            </View>
            <Mono style={{ fontSize: 11.5 }}>cap $10 · resets monthly</Mono>
          </Card>
        </Section>

        <Section title="Agent">
          <Card>
            <Row icon="checkmark-done-outline" label="Approval mode" value="Smart" onPress={() => session && Linking.openURL(`${session.agentUrl}/#/settings`)} />
            <Row icon="cash-outline" label="Spend cap" value="$5 / day" onPress={() => session && Linking.openURL(`${session.agentUrl}/#/settings`)} />
            <Row icon="construct-outline" label="Skills" value="14 enabled" onPress={() => session && Linking.openURL(`${session.agentUrl}/#/skills`)} />
            <Row icon="bulb-outline" label="Memory" value="218 entries" onPress={() => session && Linking.openURL(`${session.agentUrl}/#/learning`)} />
          </Card>
        </Section>

        <Section title="App">
          <Card>
            <View style={{ paddingHorizontal: space.s4, paddingVertical: space.s3, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomColor: colors.rule, borderBottomWidth: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3 }}>
                <Ionicons name={theme === 'dark' ? 'moon-outline' : 'sunny-outline'} size={18} color={colors.mute} />
                <Text style={{ fontFamily: fontFamily.body, fontSize: fontSize.body, color: colors.ink }}>Theme</Text>
              </View>
              <View style={{ flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: radius.r2, padding: 2 }}>
                {(['light', 'dark'] as const).map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setTheme(t)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 4,
                      backgroundColor: theme === t ? colors.surface : 'transparent',
                    }}
                  >
                    <Text style={{ fontFamily: fontFamily.mono, fontSize: 11, color: theme === t ? colors.ink : colors.mute }}>
                      {t}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Row icon="refresh-outline" label="Updates" value="3 available" pill="amber" onPress={() => router.push('/updates' as any)} />
            <Row icon="finger-print-outline" label="Face / Touch ID" />
            <Row icon="help-circle-outline" label="Help" onPress={() => session && Linking.openURL(`${session.agentUrl}/#/help`)} />
          </Card>
        </Section>

        <Pressable
          onPress={() => void signOut()}
          style={{ paddingVertical: space.s4, alignSelf: 'center' }}
        >
          <Mono style={{ color: colors.coral }}>Sign out of {session?.agentName ?? 'agent'}</Mono>
        </Pressable>
      </ScrollView>
      <TabBar active="you" onNavigate={(href) => router.push(href as any)} onCompose={() => router.push('/sheets/new-task' as any)} />
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.s2 }}>
      <Eyebrow>{title}</Eyebrow>
      {children}
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  onPress,
  pill,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  pill?: 'amber' | 'green' | 'red';
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s3,
        paddingHorizontal: space.s4,
        paddingVertical: space.s3,
        backgroundColor: pressed ? colors.surface2 : 'transparent',
        borderBottomColor: colors.rule,
        borderBottomWidth: 1,
      })}
    >
      <Ionicons name={icon} size={18} color={colors.mute} />
      <Text style={{ flex: 1, fontFamily: fontFamily.body, fontSize: fontSize.body, color: colors.ink }}>
        {label}
      </Text>
      {pill && value && (
        <Chip kind={pill as any} small>
          {value}
        </Chip>
      )}
      {!pill && value && <Mono style={{ color: colors.mute }}>{value}</Mono>}
      {onPress && <Ionicons name="chevron-forward" size={16} color={colors.soft} />}
    </Pressable>
  );
}
