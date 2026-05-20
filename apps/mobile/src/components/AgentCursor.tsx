/* Agent cursor — the white-fill arrow with a brand stroke that follows
 * the agent's clicks in the live browser session. Used to be a CSS
 * triangle hack; this is a proper SVG path with a drop-shadow filter.
 */
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Defs, Filter, FeDropShadow, Path } from 'react-native-svg';

import { useTheme } from '../theme/ThemeContext';
import { type } from '../theme/tokens';

interface Props {
  /** Reanimated `useAnimatedStyle` output — any animated transform/position style. */
  style?: unknown;
  /** One-line caption the agent is "saying" (e.g. "click 11:00am slot"). */
  caption: string;
}

export function AgentCursor({ style, caption }: Props) {
  const { colors } = useTheme();
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute' },
        style as never,
      ]}
    >
      <View style={{ width: 14, height: 18 }}>
        <Svg width={14} height={18} viewBox="0 0 14 18">
          <Defs>
            <Filter id="agent-cursor-shadow" x="-30%" y="-30%" width="160%" height="160%">
              <FeDropShadow dx="0" dy="2" stdDeviation="2" floodColor={colors.brand} floodOpacity={0.45} />
            </Filter>
          </Defs>
          <Path
            d="M0 0L0 13L4 10L7 17L9 16L6 9L11 9L0 0Z"
            fill="white"
            stroke={colors.brand}
            strokeWidth={1.4}
            filter="url(#agent-cursor-shadow)"
          />
        </Svg>
      </View>
      <View
        style={{
          position: 'absolute',
          top: 18,
          left: 12,
          backgroundColor: colors.ink,
          paddingHorizontal: 7,
          paddingVertical: 3,
          borderRadius: 4,
        }}
      >
        <Text style={{ color: colors.bg, fontFamily: type.mono, fontSize: 10.5 }}>{caption}</Text>
      </View>
    </Animated.View>
  );
}
