/* Segmented — pill-style picker with two or three options.
 *
 * Used inside Conversation to switch between Chat / Canvas. Selected
 * segment gets a raised surface look; the others sit on the soft track.
 * Optional `badge` slot on each option for counts ("Canvas 3").
 */
import { Pressable, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';
import { radius, type } from '../theme/tokens';

interface Option<T extends string> {
  value: T;
  label: string;
  badge?: number;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (next: T) => void;
}

export function Segmented<T extends string>({ options, value, onChange }: Props<T>) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surface2,
        borderRadius: radius.r2,
        padding: 2,
        gap: 2,
        borderWidth: 1,
        borderColor: colors.rule,
      }}
    >
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 7,
              borderRadius: 6,
              backgroundColor: on ? colors.surface : 'transparent',
              shadowColor: '#000',
              shadowOpacity: on ? 0.06 : 0,
              shadowRadius: on ? 3 : 0,
              shadowOffset: { width: 0, height: 1 },
              elevation: on ? 1 : 0,
            }}
          >
            <Text
              style={{
                fontFamily: type.bodyMedium,
                fontSize: 13,
                color: on ? colors.ink : colors.mute,
                letterSpacing: -0.05,
              }}
            >
              {opt.label}
            </Text>
            {opt.badge != null && opt.badge > 0 && (
              <View
                style={{
                  backgroundColor: on ? colors.brandSoft : colors.surface2,
                  borderRadius: 999,
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                }}
              >
                <Text
                  style={{
                    fontFamily: type.monoMedium,
                    fontSize: 10,
                    color: on ? colors.brandInk : colors.mute,
                  }}
                >
                  {opt.badge}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
