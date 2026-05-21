/* Theme picker — bottom sheet route. Two visual cards previewing the
 * actual palette: warm cream for Light, charcoal for Dark. Selected
 * card gets a brand-orange border + a check badge.
 */
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { BottomSheet } from '../../src/components/BottomSheet';
import { Mono } from '../../src/components/primitives';
import { confirm as hapticConfirm } from '../../src/lib/haptics';
import { useTheme } from '../../src/theme/ThemeContext';
import { radius, space, type as fontFamily, type Theme } from '../../src/theme/tokens';

export default function ThemeSheet() {
  const router = useRouter();
  const { theme, setTheme, colors } = useTheme();

  const handleSelect = (next: Theme) => {
    hapticConfirm();
    setTheme(next);
    router.back();
  };

  return (
    <BottomSheet onClose={() => router.back()}>
      <View style={{ gap: space.s4 }}>
        <View>
          <Mono>Appearance</Mono>
          <Text
            style={{
              marginTop: 4,
              fontFamily: fontFamily.display,
              fontSize: 22,
              letterSpacing: -0.3,
              color: colors.ink,
            }}
          >
            Pick a theme
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <ThemeCard
            label="Light"
            description="Warm paper · daylight"
            previewBg="#FBF8F2"
            previewFg="#0E0F12"
            selected={theme === 'light'}
            icon="sunny-outline"
            onPress={() => handleSelect('light')}
            accent={colors.brand}
          />
          <ThemeCard
            label="Dark"
            description="Charcoal · low-light"
            previewBg="#0A0B0E"
            previewFg="#F2F3F6"
            selected={theme === 'dark'}
            icon="moon-outline"
            onPress={() => handleSelect('dark')}
            accent={colors.brand}
          />
        </View>

        <Mono style={{ fontSize: 11, textAlign: 'center', marginTop: space.s1 }}>
          Auto-switching follows system on iOS · always-on toggle on Android
        </Mono>
      </View>
    </BottomSheet>
  );
}

function ThemeCard({
  label,
  description,
  previewBg,
  previewFg,
  selected,
  icon,
  onPress,
  accent,
}: {
  label: string;
  description: string;
  previewBg: string;
  previewFg: string;
  selected: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accent: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        padding: space.s3,
        borderRadius: radius.r4,
        backgroundColor: previewBg,
        borderWidth: 2,
        borderColor: selected ? accent : 'rgba(127,127,127,0.18)',
        opacity: pressed ? 0.9 : 1,
        minHeight: 120,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Ionicons name={icon} size={20} color={previewFg} />
        {selected && (
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="checkmark" size={14} color="#FFFFFF" />
          </View>
        )}
      </View>
      <View style={{ marginTop: space.s4 }}>
        <Text
          style={{
            fontFamily: fontFamily.bodyMedium,
            fontSize: 15,
            color: previewFg,
            letterSpacing: -0.1,
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            fontFamily: fontFamily.body,
            fontSize: 12,
            color: previewFg,
            opacity: 0.6,
            marginTop: 2,
          }}
        >
          {description}
        </Text>
      </View>
    </Pressable>
  );
}
