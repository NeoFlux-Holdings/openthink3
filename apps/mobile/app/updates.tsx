/* Updates — friendlier "Sync" screen for non-technical users. */
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Card, Chip, Eyebrow, H1, Mono, Screen } from '../src/components/primitives';
import { useSession } from '../src/lib/session-store';
import { useTheme } from '../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../src/theme/tokens';

const UPDATES = [
  { id: '1', title: 'Improved booking reliability', safety: 'safe', desc: 'Calendly flow handles two more layouts.' },
  { id: '2', title: 'Migrate audit log indexes', safety: 'review', desc: 'Schema change · backup first.' },
  { id: '3', title: 'Skill: invoice extraction', safety: 'safe', desc: 'New community skill (gstack pack).' },
];

export default function Updates() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { session: _session } = useSession();

  return (
    <Screen>
      <View
        style={{
          paddingTop: insets.top + space.s2,
          paddingHorizontal: space.s4,
          paddingBottom: space.s3,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s3,
          borderBottomColor: colors.rule,
          borderBottomWidth: 1,
          backgroundColor: colors.bg,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <H1 style={{ fontSize: fontSize.h2 }}>Updates</H1>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.s5, gap: space.s5 }}>
        <Card style={{ padding: space.s5, gap: space.s3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s4 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.r3,
                backgroundColor: colors.brandSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="refresh-outline" size={20} color={colors.brand} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontFamily: fontFamily.display500, fontSize: fontSize.h3, color: colors.ink }}>
                3 updates available
              </Text>
              <Mono style={{ fontSize: 11.5 }}>last checked 2m ago</Mono>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.s2 }}>
            <Chip kind="green" small>
              ✓ 2 safe
            </Chip>
            <Chip kind="amber" small>
              ⚠ 1 needs review
            </Chip>
          </View>
          <View style={{ flexDirection: 'row', gap: space.s2 }}>
            <Button kind="default" size="md" style={{ flex: 1 }}>
              Check now
            </Button>
            <Button kind="brand" size="md" style={{ flex: 1 }}>
              Apply 2 safe →
            </Button>
          </View>
        </Card>

        <View style={{ gap: space.s2 }}>
          <Eyebrow>Available</Eyebrow>
          {UPDATES.map((u) => (
            <Card key={u.id} style={{ padding: space.s4, gap: space.s2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: fontSize.body, color: colors.ink, flex: 1 }}>
                  {u.title}
                </Text>
                <Chip kind={u.safety === 'safe' ? 'green' : 'amber'} small>
                  {u.safety === 'safe' ? 'safe' : 'review'}
                </Chip>
              </View>
              <Body style={{ color: colors.mute }}>{u.desc}</Body>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                {u.safety === 'safe' ? (
                  <Button kind="default" size="sm">
                    Apply
                  </Button>
                ) : (
                  <Button kind="default" size="sm">
                    Review →
                  </Button>
                )}
              </View>
            </Card>
          ))}
        </View>

        <View style={{ gap: space.s2 }}>
          <Eyebrow>Your agent wants to share</Eyebrow>
          <Card style={{ padding: space.s4, gap: space.s2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: radius.r3,
                  backgroundColor: colors.brandSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="sparkles" size={18} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: fontSize.body, color: colors.ink }}>
                  Improved Calendly booking reliability
                </Text>
                <Body style={{ color: colors.mute }}>tested 8/8 · ~22 lines</Body>
              </View>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s2 }}>
              <Button kind="default" size="sm">
                Preview
              </Button>
              <Button kind="brand" size="sm">
                Share
              </Button>
            </View>
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}
