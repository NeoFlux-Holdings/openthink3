/* Shared visual primitives for the mobile app — mirrors the web's
 * `primitives.css` styles. Theme-aware via useTheme(). Reused across every
 * screen so we never re-roll the same chip/dot/button.
 */
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  type TextProps,
  type TextStyle,
  View,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '../theme/ThemeContext';
import { type, fontSize as fs, radius, space } from '../theme/tokens';

/* ----- Text styles ----- */

export function Eyebrow({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  const { colors } = useTheme();
  return (
    <Text
      style={[
        {
          fontFamily: type.monoMedium,
          fontSize: 11,
          letterSpacing: 1.1,
          textTransform: 'uppercase',
          color: colors.mute,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function H1(props: TextProps) {
  const { colors } = useTheme();
  return (
    <Text
      {...props}
      style={[
        {
          fontFamily: type.display,
          fontSize: fs.h1,
          letterSpacing: -0.5,
          color: colors.ink,
          lineHeight: fs.h1 * 1.1,
        },
        props.style,
      ]}
    />
  );
}

export function H2(props: TextProps) {
  const { colors } = useTheme();
  return (
    <Text
      {...props}
      style={[
        {
          fontFamily: type.display500,
          fontSize: fs.h2,
          letterSpacing: -0.3,
          color: colors.ink,
        },
        props.style,
      ]}
    />
  );
}

export function H3(props: TextProps) {
  const { colors } = useTheme();
  return (
    <Text
      {...props}
      style={[
        { fontFamily: type.display500, fontSize: fs.h3, color: colors.ink, letterSpacing: -0.2 },
        props.style,
      ]}
    />
  );
}

export function Body(props: TextProps) {
  const { colors } = useTheme();
  return (
    <Text
      {...props}
      style={[{ fontFamily: type.body, fontSize: fs.body, color: colors.ink2 }, props.style]}
    />
  );
}

export function Mono(props: TextProps) {
  const { colors } = useTheme();
  return (
    <Text
      {...props}
      style={[{ fontFamily: type.mono, fontSize: fs.micro, color: colors.mute }, props.style]}
    />
  );
}

/* ----- Dot indicator ----- */

export type DotKind = 'green' | 'coral' | 'amber' | 'brand' | 'idle';

export function Dot({ kind = 'green', size = 6 }: { kind?: DotKind; size?: number }) {
  const { colors } = useTheme();
  const map: Record<DotKind, string> = {
    green: colors.green,
    coral: colors.coral,
    amber: colors.amber,
    brand: colors.brand,
    idle: colors.soft,
  };
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: map[kind],
      }}
    />
  );
}

/* ----- Chip ----- */

export type ChipKind = 'default' | 'brand' | 'coral' | 'green' | 'amber' | 'red' | 'blue' | 'ink';

export function Chip({
  kind = 'default',
  children,
  small,
  style,
  leading,
}: {
  kind?: ChipKind;
  children: React.ReactNode;
  small?: boolean;
  style?: ViewStyle;
  leading?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const bgMap: Record<ChipKind, string> = {
    default: colors.surface2,
    brand: colors.brandSoft,
    coral: colors.coralSoft,
    green: colors.greenSoft,
    amber: colors.amberSoft,
    red: colors.redSoft,
    blue: colors.blueSoft,
    ink: colors.ink,
  };
  const fgMap: Record<ChipKind, string> = {
    default: colors.ink2,
    brand: colors.brandInk,
    coral: colors.coralInk,
    green: colors.greenInk,
    amber: colors.amberInk,
    red: colors.redInk,
    blue: colors.blueInk,
    ink: colors.bg,
  };
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          height: small ? 18 : 22,
          paddingHorizontal: small ? 7 : 9,
          backgroundColor: bgMap[kind],
          borderRadius: radius.pill,
          alignSelf: 'flex-start',
        },
        kind === 'default' && { borderWidth: 1, borderColor: colors.rule },
        style,
      ]}
    >
      {leading}
      <Text
        style={{
          fontFamily: type.bodyMedium,
          fontSize: small ? 10.5 : 11.5,
          color: fgMap[kind],
          letterSpacing: -0.05,
        }}
      >
        {children}
      </Text>
    </View>
  );
}

/* ----- Card ----- */

export function Card({ children, style, soft }: { children: React.ReactNode; style?: ViewStyle; soft?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: soft ? colors.surface2 : colors.surface,
          borderColor: colors.rule,
          borderWidth: 1,
          borderRadius: radius.r4,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* ----- Button ----- */

export type ButtonKind = 'default' | 'brand' | 'ink' | 'ghost';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  children: React.ReactNode;
  kind?: ButtonKind;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({ children, kind = 'default', size = 'md', loading, style, ...rest }: ButtonProps) {
  const { colors } = useTheme();
  const heights = { sm: 30, md: 38, lg: 46, xl: 54 } as const;
  const fontSizes = { sm: 12.5, md: 13.5, lg: 14.5, xl: 15.5 } as const;
  const padX = { sm: 12, md: 16, lg: 22, xl: 26 } as const;

  const bg = {
    default: colors.surface,
    brand: colors.brand,
    ink: colors.ink,
    ghost: 'transparent',
  }[kind];

  const fg = {
    default: colors.ink,
    brand: '#FFFFFF',
    ink: colors.bg,
    ghost: colors.ink2,
  }[kind];

  const borderColor = {
    default: colors.rule2,
    brand: colors.brand,
    ink: colors.ink,
    ghost: 'transparent',
  }[kind];

  return (
    <Pressable
      {...rest}
      disabled={rest.disabled || loading}
      style={({ pressed }) => [
        {
          height: heights[size],
          paddingHorizontal: padX[size],
          backgroundColor: bg,
          borderColor,
          borderWidth: 1,
          borderRadius: size === 'sm' ? radius.r2 : radius.r3,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: rest.disabled || loading ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text
          style={{
            color: fg,
            fontFamily: type.bodyMedium,
            fontSize: fontSizes[size],
            letterSpacing: -0.1,
          }}
        >
          {children}
        </Text>
      )}
    </Pressable>
  );
}

/* ----- Tab pill (used in filter chips, pickers, mode toggles) ----- */

export function PillPicker<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: on ? colors.ink : colors.rule2,
              backgroundColor: on ? colors.ink : 'transparent',
            }}
          >
            <Text
              style={{
                fontFamily: type.bodyMedium,
                fontSize: 12,
                color: on ? colors.bg : colors.mute,
              }}
            >
              {opt.label}
              {opt.count != null && (
                <Text style={{ opacity: 0.5 }}> · {opt.count}</Text>
              )}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ----- Avatar (brand → coral gradient with letter) ----- */

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.brand,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          position: 'absolute',
          right: -size * 0.2,
          bottom: -size * 0.2,
          width: size,
          height: size,
          borderRadius: size,
          backgroundColor: colors.coral,
          opacity: 0.85,
        }}
      />
      <Text style={{ color: '#FFFFFF', fontFamily: type.bodyMedium, fontSize: size * 0.42 }}>
        {(name || '?').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

/* ----- Section header (used between groups in lists) ----- */

export function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 4, marginTop: space.s5, marginBottom: space.s2 }}>
      <Eyebrow>{children}</Eyebrow>
      {count != null && (
        <Text style={{ fontFamily: type.mono, fontSize: 10.5, color: colors.soft }}>
          · {count}
        </Text>
      )}
    </View>
  );
}

/* ----- Shared screen wrapper ----- */

export function Screen({ children, style }: ViewProps) {
  const { colors } = useTheme();
  return (
    <View style={[{ flex: 1, backgroundColor: colors.bg }, style]}>{children}</View>
  );
}

export const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
