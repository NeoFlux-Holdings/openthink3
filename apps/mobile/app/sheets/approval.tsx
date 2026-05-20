/* Approval bottom sheet — fired from a notification or the Today screen.
 *
 * Shows the preview card, two chips, and Skip / Send buttons. The "Edit
 * before sending" link routes back to the thread where the user can adjust
 * the agent's draft.
 */
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Card, Chip, Eyebrow, H2, Mono, Screen } from '../../src/components/primitives';
import { respondToApproval } from '../../src/lib/api';
import { useSession } from '../../src/lib/session-store';
import { useTheme } from '../../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../../src/theme/tokens';

export default function ApprovalSheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const { colors } = useTheme();
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  const [responding, setResponding] = useState<'send' | 'skip' | null>(null);

  const respond = async (decision: 'send' | 'skip' | 'edit') => {
    if (!session || !params.id) {
      router.back();
      return;
    }
    setResponding(decision === 'edit' ? null : decision);
    try {
      await respondToApproval(session, params.id, decision);
    } catch {
      /* fall through */
    } finally {
      router.back();
    }
  };

  return (
    <Screen style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <Pressable style={{ flex: 1 }} onPress={() => router.back()} />
      <View
        style={{
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.r5,
          borderTopRightRadius: radius.r5,
          paddingHorizontal: space.s5,
          paddingTop: space.s4,
          paddingBottom: insets.bottom + space.s5,
        }}
      >
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.rule2, alignSelf: 'center', marginBottom: space.s4 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.r3,
              backgroundColor: colors.coralSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="mail-outline" size={20} color={colors.coralInk} />
          </View>
          <View style={{ flex: 1 }}>
            <Eyebrow>Agent needs approval</Eyebrow>
            <H2 style={{ fontSize: 18 }}>Send email to Sarah Cohen</H2>
          </View>
        </View>

        <Card soft style={{ padding: space.s4, marginTop: space.s4, gap: space.s2 }}>
          <Mono>To · sarah@tilt.com</Mono>
          <Mono style={{ color: colors.coralInk }}>~$0.001 to send</Mono>
          <Body style={{ marginTop: space.s2, color: colors.ink2 }}>
            Confirming Thursday 2pm. Looking forward to talking through the launch plan.
          </Body>
        </Card>

        <View style={{ flexDirection: 'row', gap: space.s2, marginTop: space.s4 }}>
          <Chip kind="green" small>
            ✓ Within smart-auto rules
          </Chip>
          <Chip kind="default" small>
            first email to recipient
          </Chip>
        </View>

        <View style={{ flexDirection: 'row', gap: space.s3, marginTop: space.s5 }}>
          <Button kind="default" size="lg" style={{ flex: 1 }} onPress={() => respond('skip')} loading={responding === 'skip'}>
            Skip
          </Button>
          <Button kind="brand" size="lg" style={{ flex: 1 }} onPress={() => respond('send')} loading={responding === 'send'}>
            Send
          </Button>
        </View>

        <Pressable onPress={() => respond('edit')} style={{ paddingVertical: space.s4, alignSelf: 'center' }}>
          <Text style={{ fontFamily: fontFamily.bodyMedium, color: colors.brand, fontSize: 13 }}>
            Edit before sending →
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}
