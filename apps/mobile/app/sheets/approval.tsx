/* Approval bottom sheet — fired from a notification or Today screen.
 *
 * Real BottomSheet underneath so swipe-down dismisses + backdrop fades.
 * Haptics: medium confirm on Send, warning on Skip, light tap on the Edit link.
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BottomSheet } from '../../src/components/BottomSheet';
import { Body, Button, Card, Chip, Eyebrow, H2, Mono } from '../../src/components/primitives';
import { confirm as hapticConfirm, tap as hapticTap, warning as hapticWarn } from '../../src/lib/haptics';
import { respondToApproval } from '../../src/lib/api';
import { useSession } from '../../src/lib/session-store';
import { useTheme } from '../../src/theme/ThemeContext';
import { radius, space, type as fontFamily } from '../../src/theme/tokens';

export default function ApprovalSheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const { colors } = useTheme();
  const { session } = useSession();
  const [responding, setResponding] = useState<'send' | 'skip' | null>(null);

  const respond = async (decision: 'send' | 'skip' | 'edit') => {
    if (decision === 'send') hapticConfirm();
    else if (decision === 'skip') hapticWarn();
    else hapticTap();

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
    <BottomSheet onClose={() => router.back()}>
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

      <View style={{ flexDirection: 'row', gap: space.s2, marginTop: space.s4, flexWrap: 'wrap' }}>
        <Chip kind="green" small>
          ✓ Within smart-auto rules
        </Chip>
        <Chip kind="default" small>
          first email to recipient
        </Chip>
      </View>

      <View style={{ flexDirection: 'row', gap: space.s3, marginTop: space.s5 }}>
        <Button kind="default" size="lg" style={{ flex: 1 }} onPress={() => void respond('skip')} loading={responding === 'skip'}>
          Skip
        </Button>
        <Button kind="brand" size="lg" style={{ flex: 1 }} onPress={() => void respond('send')} loading={responding === 'send'}>
          Send
        </Button>
      </View>

      <Pressable onPress={() => void respond('edit')} style={{ paddingVertical: space.s4, alignSelf: 'center' }}>
        <Text style={{ fontFamily: fontFamily.bodyMedium, color: colors.brand, fontSize: 13 }}>
          Edit before sending →
        </Text>
      </Pressable>
    </BottomSheet>
  );
}
