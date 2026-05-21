/* Approval bottom sheet — fired from a notification, Today screen, or
 * an inline approval card inside a thread.
 *
 * Lifecycle:
 *   1. Mount with `id` from the route. Fetch the approval list from the
 *      agent and look up by id. (Cheap — typically <10 pending at once.)
 *   2. Render real title/body/meta. Show a Skip/Send pair + an Edit link.
 *   3. On press → POST /api/mobile/approvals/:id/respond with decision.
 *      Server-side, the orchestrator resolves the waiting promise.
 *
 * "Send"/"Skip" are mobile-friendly verbs; the wire vocabulary is
 * `approve | deny | edit` (normalized server-side in routes/mobile.ts).
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BottomSheet } from '../../src/components/BottomSheet';
import { Body, Button, Card, Chip, Eyebrow, H2, Mono } from '../../src/components/primitives';
import { confirm as hapticConfirm, tap as hapticTap, warning as hapticWarn } from '../../src/lib/haptics';
import { getApprovals, respondToApproval, type Approval } from '../../src/lib/api';
import { useSession } from '../../src/lib/session-store';
import { useTheme } from '../../src/theme/ThemeContext';
import { radius, space, type as fontFamily } from '../../src/theme/tokens';

export default function ApprovalSheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const { colors } = useTheme();
  const { session } = useSession();
  const [responding, setResponding] = useState<'send' | 'skip' | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch real content by id. If the id is missing or the approval is no
  // longer pending we fall back to a clear "already resolved" state rather
  // than rendering the design fixture.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!session || !params.id) {
        setError('Missing approval id.');
        setLoading(false);
        return;
      }
      try {
        const { approvals } = await getApprovals(session);
        if (cancelled) return;
        const match = approvals.find((a) => a.id === params.id);
        if (match) {
          setApproval(match);
        } else {
          setError('That approval has already been resolved.');
        }
      } catch {
        if (!cancelled) setError('Could not reach your agent.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, params.id]);

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
      /* fall through — close anyway so the user isn't trapped on a dead approval */
    } finally {
      router.back();
    }
  };

  return (
    <BottomSheet onClose={() => router.back()}>
      {loading ? (
        <View style={{ paddingVertical: space.s7, alignItems: 'center', gap: space.s3 }}>
          <ActivityIndicator color={colors.brand} />
          <Mono>Loading approval…</Mono>
        </View>
      ) : error || !approval ? (
        <View style={{ paddingVertical: space.s6, gap: space.s3 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.r3,
              backgroundColor: colors.amberSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="checkmark-circle-outline" size={20} color={colors.amberInk} />
          </View>
          <H2 style={{ fontSize: 18 }}>{error ?? 'Nothing to approve'}</H2>
          <Body style={{ color: colors.mute }}>
            The agent may have already moved on, or you might have a stale notification.
          </Body>
          <Button kind="default" size="lg" onPress={() => router.back()}>
            Close
          </Button>
        </View>
      ) : (
        <ApprovalBody approval={approval} responding={responding} onRespond={respond} />
      )}
    </BottomSheet>
  );
}

function ApprovalBody({
  approval,
  responding,
  onRespond,
}: {
  approval: Approval;
  responding: 'send' | 'skip' | null;
  onRespond: (decision: 'send' | 'skip' | 'edit') => void;
}) {
  const { colors } = useTheme();
  const isCoral = approval.kind === 'send' || approval.kind === 'tool';
  const iconName: keyof typeof Ionicons.glyphMap =
    approval.kind === 'send' ? 'mail-outline'
    : approval.kind === 'spend' ? 'cash-outline'
    : approval.kind === 'tool' ? 'flash-outline'
    : 'help-circle-outline';

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.r3,
            backgroundColor: isCoral ? colors.coralSoft : colors.amberSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={iconName} size={20} color={isCoral ? colors.coralInk : colors.amberInk} />
        </View>
        <View style={{ flex: 1 }}>
          <Eyebrow>Agent needs approval</Eyebrow>
          <H2 style={{ fontSize: 18 }} numberOfLines={2}>{approval.title}</H2>
        </View>
      </View>

      <Card soft style={{ padding: space.s4, marginTop: space.s4, gap: space.s2 }}>
        {approval.meta && <Mono>{approval.meta}</Mono>}
        {approval.costUsd != null && (
          <Mono style={{ color: isCoral ? colors.coralInk : colors.amberInk }}>
            ~${approval.costUsd.toFixed(3)} to run
          </Mono>
        )}
        {approval.body && (
          <Body style={{ marginTop: space.s2, color: colors.ink2, lineHeight: 20 }}>
            {approval.body}
          </Body>
        )}
      </Card>

      <View style={{ flexDirection: 'row', gap: space.s2, marginTop: space.s4, flexWrap: 'wrap' }}>
        <Chip kind="green" small>
          ✓ Within smart-auto rules
        </Chip>
        <Chip kind="default" small>
          {timeAgo(approval.createdAt)}
        </Chip>
      </View>

      <View style={{ flexDirection: 'row', gap: space.s3, marginTop: space.s5 }}>
        <Button
          kind="default"
          size="lg"
          style={{ flex: 1 }}
          onPress={() => onRespond('skip')}
          loading={responding === 'skip'}
        >
          Skip
        </Button>
        <Button
          kind="brand"
          size="lg"
          style={{ flex: 1 }}
          onPress={() => onRespond('send')}
          loading={responding === 'send'}
        >
          Send
        </Button>
      </View>

      <Pressable onPress={() => onRespond('edit')} style={{ paddingVertical: space.s4, alignSelf: 'center' }}>
        <Text style={{ fontFamily: fontFamily.bodyMedium, color: colors.brand, fontSize: 13 }}>
          Edit before sending →
        </Text>
      </Pressable>
    </>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 24 * 3600_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}
