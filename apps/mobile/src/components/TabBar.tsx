/* Bottom tab bar — replaces the default expo-router tabs UI so we get full
 * control over the rendering. Five anchored slots:
 *   Today · Threads · (FAB) · Library · You
 *
 * The FAB is the brand-orange capsule in the middle and opens the New Task
 * sheet rather than navigating to a tab.
 */
import { Pressable, type StyleProp, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, space, type } from '../theme/tokens';

export type TabKey = 'today' | 'threads' | 'library' | 'you';

const TABS: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap; href: string }[] = [
  { key: 'today', label: 'Today', icon: 'sunny-outline', href: '/' },
  { key: 'threads', label: 'Threads', icon: 'chatbubble-ellipses-outline', href: '/threads' },
  { key: 'library', label: 'Library', icon: 'albums-outline', href: '/library' },
  { key: 'you', label: 'You', icon: 'person-circle-outline', href: '/you' },
];

interface Props {
  active: TabKey;
  onNavigate: (href: string) => void;
  onCompose: () => void;
}

export function TabBar({ active, onNavigate, onCompose }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: insets.bottom > 0 ? insets.bottom : 12,
        paddingTop: 8,
        paddingHorizontal: 12,
        backgroundColor: colors.bg2,
        borderTopColor: colors.rule,
        borderTopWidth: 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {TABS.slice(0, 2).map((t) => (
          <TabSlot
            key={t.key}
            active={t.key === active}
            label={t.label}
            icon={t.icon}
            onPress={() => onNavigate(t.href)}
          />
        ))}

        <Fab onPress={onCompose} />

        {TABS.slice(2).map((t) => (
          <TabSlot
            key={t.key}
            active={t.key === active}
            label={t.label}
            icon={t.icon}
            onPress={() => onNavigate(t.href)}
          />
        ))}
      </View>
    </View>
  );
}

function TabSlot({
  active,
  label,
  icon,
  onPress,
}: {
  active: boolean;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{ alignItems: 'center', justifyContent: 'center', minWidth: 56, paddingVertical: 4 }}
    >
      <Ionicons name={icon} size={22} color={active ? colors.ink : colors.mute} />
      <Text
        style={{
          marginTop: 3,
          fontFamily: type.bodyMedium,
          fontSize: 10.5,
          color: active ? colors.ink : colors.mute,
          letterSpacing: -0.05,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Fab({ onPress, style }: { onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: 56,
          height: 40,
          borderRadius: radius.pill,
          backgroundColor: colors.brand,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: -2,
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        style,
      ]}
      accessibilityLabel="New task"
    >
      <Ionicons name="add" color="#FFFFFF" size={22} />
    </Pressable>
  );
}

/* Tabbar height — exposed so screens can pad their bottom edge. */
export const TAB_BAR_HEIGHT = 78;
export { space, fontSize };
