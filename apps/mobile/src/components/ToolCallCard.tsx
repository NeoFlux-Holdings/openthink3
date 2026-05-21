/* ToolCallCard — inline status card for an agent tool invocation.
 *
 * Mirrors the desktop `shell__tool` pattern. Four states:
 *   running           — brand-soft tint, spinning glyph
 *   done              — green-soft tint, checkmark, collapsible output
 *   approval-needed   — coral-soft tint with Approve/Reject buttons
 *   blocked / error   — coral-soft tint, error icon, reason text
 *
 * Tap to expand (when there's output). Tap-and-hold to copy the JSON
 * payload (handy for debugging).
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../theme/tokens';

export type ToolCallStatus = 'running' | 'done' | 'approval-needed' | 'blocked' | 'error';

export interface ToolCallProps {
  name: string;
  status: ToolCallStatus;
  output?: unknown;
  /** Optional input arguments — shown when the user expands the card. */
  args?: unknown;
  /** Failure / blocked reason. Shown next to the icon. */
  reason?: string;
  /** Approval handlers — only rendered when status === 'approval-needed'. */
  onApprove?: () => void;
  onReject?: () => void;
  /** Cost estimate to show on the approval state. */
  estCostCents?: number;
}

export function ToolCallCard(props: ToolCallProps) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const tint =
    props.status === 'done' ? { bg: colors.greenSoft, fg: colors.greenInk, accent: colors.green }
    : props.status === 'running' ? { bg: colors.brandSoft, fg: colors.brandInk, accent: colors.brand }
    : props.status === 'approval-needed' ? { bg: colors.coralSoft, fg: colors.coralInk, accent: colors.coral }
    : { bg: colors.coralSoft, fg: colors.coralInk, accent: colors.coral }; // blocked/error

  const icon: keyof typeof Ionicons.glyphMap =
    props.status === 'done' ? 'checkmark-circle-outline'
    : props.status === 'running' ? 'sync-outline'
    : props.status === 'approval-needed' ? 'alert-circle-outline'
    : props.status === 'blocked' ? 'close-circle-outline'
    : 'warning-outline';

  // Reanimated rotation for the running spinner — UI-thread driven so
  // the glyph never stutters even while messages stream.
  const rotation = useSharedValue(0);
  if (props.status === 'running' && rotation.value === 0) {
    rotation.value = withRepeat(
      withTiming(360, { duration: 1100, easing: Easing.linear }),
      -1,
    );
  }
  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const canExpand = props.status === 'done' || props.status === 'blocked' || props.status === 'error';
  const outputText = props.output != null ? safeJson(props.output) : null;
  const argsText = props.args != null ? safeJson(props.args) : null;

  return (
    <Pressable
      onPress={() => canExpand && setExpanded((v) => !v)}
      style={{
        backgroundColor: tint.bg,
        borderRadius: radius.r3,
        paddingHorizontal: space.s3,
        paddingVertical: 8,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Animated.View style={props.status === 'running' ? spinStyle : undefined}>
          <Ionicons name={icon} size={14} color={tint.fg} />
        </Animated.View>
        <Text
          style={{
            flex: 1,
            fontFamily: fontFamily.monoMedium,
            fontSize: 11.5,
            color: tint.fg,
            letterSpacing: 0.02,
          }}
          numberOfLines={1}
        >
          {props.name}
        </Text>
        <Text
          style={{
            fontFamily: fontFamily.body,
            fontSize: 11,
            color: tint.fg,
            opacity: 0.75,
          }}
        >
          {props.status === 'running' ? 'running…'
          : props.status === 'done' ? 'done'
          : props.status === 'approval-needed' ? 'needs approval'
          : props.reason ?? props.status}
        </Text>
        {canExpand && (
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={13}
            color={tint.fg}
            style={{ opacity: 0.6 }}
          />
        )}
      </View>

      {props.status === 'approval-needed' && (
        <View style={{ gap: 8 }}>
          {argsText && (
            <View
              style={{
                backgroundColor: 'rgba(0,0,0,0.05)',
                borderRadius: 6,
                padding: 8,
              }}
            >
              <Text
                style={{
                  fontFamily: fontFamily.mono,
                  fontSize: 11,
                  color: tint.fg,
                }}
                numberOfLines={4}
              >
                {argsText}
              </Text>
            </View>
          )}
          {props.estCostCents != null && (
            <Text
              style={{
                fontFamily: fontFamily.mono,
                fontSize: 10.5,
                color: tint.fg,
                opacity: 0.7,
              }}
            >
              ~${(props.estCostCents / 100).toFixed(3)} to run
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={props.onReject}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 8,
                borderRadius: 8,
                backgroundColor: 'rgba(255,255,255,0.6)',
                borderWidth: 1,
                borderColor: 'rgba(0,0,0,0.06)',
              }}
            >
              <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 12.5, color: tint.fg }}>
                Reject
              </Text>
            </Pressable>
            <Pressable
              onPress={props.onApprove}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 8,
                borderRadius: 8,
                backgroundColor: tint.accent,
              }}
            >
              <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 12.5, color: '#FFFFFF' }}>
                Approve
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {expanded && outputText && (
        <View
          style={{
            backgroundColor: 'rgba(0,0,0,0.05)',
            borderRadius: 6,
            padding: 8,
          }}
        >
          <Text
            style={{
              fontFamily: fontFamily.mono,
              fontSize: fontSize.caption,
              color: tint.fg,
            }}
          >
            {outputText}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
