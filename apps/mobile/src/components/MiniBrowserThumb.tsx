/* MiniBrowserThumb — tiny inline preview of an agent-driven browser session.
 *
 * The hero card on Today uses one of these so you can see — at a glance —
 * that your agent is on a real page picking a real slot. It's not an
 * iframe, just a static representation built with primitives:
 *
 *   ┌─────────────────────────┐
 *   │ ● ● ●  calendly.com/…   │  ← chrome strip
 *   ├─────────────────────────┤
 *   │ ███████                 │
 *   │ ████████████            │
 *   │ ┌──┬──┬──┐              │  ← calendar slot grid (one selected)
 *   │ └──┴──┴──┘              │
 *   └─────────────────────────┘
 *
 * The agent cursor (orange-shadowed arrow SVG) sits over the selected slot
 * to communicate "this is what the agent just clicked".
 */
import { View } from 'react-native';
import Svg, { Defs, FeDropShadow, Filter, Path } from 'react-native-svg';

import { useTheme } from '../theme/ThemeContext';
import { Mono } from './primitives';

interface Props {
  /** Override the URL pill text. */
  url?: string;
  /** Hide the agent cursor. Defaults to visible. */
  hideCursor?: boolean;
}

export function MiniBrowserThumb({ url = 'calendly.com/derek-m', hideCursor }: Props) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#FAFAF7',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Chrome strip — traffic lights + URL pill. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 6,
          borderBottomWidth: 0.5,
          borderBottomColor: '#E5E2DA',
        }}
      >
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#E54B2C' }} />
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#F5C141' }} />
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#37C667' }} />
        <View
          style={{
            flex: 1,
            marginLeft: 6,
            height: 14,
            backgroundColor: '#FFFFFF',
            borderRadius: 999,
            paddingHorizontal: 7,
            justifyContent: 'center',
          }}
        >
          <Mono style={{ fontSize: 8.5, color: '#888' }} numberOfLines={1}>
            {url}
          </Mono>
        </View>
      </View>

      {/* Page content — heading + 6-slot calendar grid. */}
      <View style={{ paddingHorizontal: 10, paddingTop: 8 }}>
        <View style={{ width: '40%', height: 6, backgroundColor: '#111', borderRadius: 2 }} />
        <View style={{ width: '70%', height: 4, backgroundColor: '#CCC', borderRadius: 2, marginTop: 4 }} />
        <View
          style={{
            marginTop: 8,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 3,
          }}
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View
              key={i}
              style={{
                width: '31%',
                height: 14,
                backgroundColor: i === 3 ? '#111' : '#FFFFFF',
                borderColor: '#DDD',
                borderWidth: 1,
                borderRadius: 2,
              }}
            />
          ))}
        </View>
      </View>

      {/* Agent cursor — SVG arrow with brand-orange dropshadow. */}
      {!hideCursor && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 36,
            left: 64,
          }}
        >
          <Svg width={12} height={15} viewBox="0 0 14 18">
            <Defs>
              <Filter id="mb-shadow" x="-50%" y="-50%" width="200%" height="200%">
                <FeDropShadow dx="0" dy="1" stdDeviation="1.0" floodColor={colors.brand} floodOpacity={0.55} />
              </Filter>
            </Defs>
            <Path
              d="M0 0L0 13L4 10L7 17L9 16L6 9L11 9L0 0Z"
              fill="#FFFFFF"
              stroke={colors.brand2}
              strokeWidth={1.4}
              filter="url(#mb-shadow)"
            />
          </Svg>
        </View>
      )}
    </View>
  );
}
