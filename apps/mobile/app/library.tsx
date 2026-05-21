/* Library — 2-col grid of artifact tiles with type-specific mini previews.
 *
 * Doc rows render as horizontal bars (first one filled = heading).
 * Code tiles render as a dark charcoal terminal with faded mono lines.
 * Chart tiles render as a 7-bar histogram in brand orange.
 * Table tiles render as a 5-row grid of column placeholders.
 * Image tiles render as a brand→coral gradient swatch.
 * Webpage tiles render with a thin chrome strip + a couple stub lines.
 *
 * Tapping a tile opens the artifact in the user's browser (the web shell
 * renders these much better than RN can on a phone).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { LargeTitleHeader } from '../src/components/LargeTitleHeader';
import { Mono, Screen } from '../src/components/primitives';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { Skeleton } from '../src/components/Skeleton';
import { TabBar, TAB_BAR_HEIGHT } from '../src/components/TabBar';
import { getLibrary } from '../src/lib/api';
import { useSession } from '../src/lib/session-store';
import { tabReTapped } from '../src/lib/events';
import { useTheme } from '../src/theme/ThemeContext';
import { radius, space, type as fontFamily } from '../src/theme/tokens';

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

type Filter = 'all' | 'doc' | 'code' | 'table' | 'image' | 'chart' | 'webpage';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'doc', label: 'Docs' },
  { value: 'code', label: 'Code' },
  { value: 'table', label: 'Tables' },
  { value: 'image', label: 'Images' },
  { value: 'chart', label: 'Charts' },
  { value: 'webpage', label: 'Webpages' },
];

interface Item {
  id: string;
  title: string;
  type: string;
  size: string;
  age: string;
  src?: string;
}

const FALLBACK: Item[] = [
  { id: '1', title: 'launch.md', type: 'doc', size: '4.2KB', age: '12m', src: 'Q3 launch' },
  { id: '2', title: 'Q3 candidates', type: 'table', size: '1.4KB', age: '14m', src: 'Q3 launch' },
  { id: '3', title: 'wallpaper v3', type: 'image', size: '482KB', age: '1d', src: 'Brand' },
  { id: '4', title: 'book-meeting.skill.ts', type: 'code', size: '2.1KB', age: '2h', src: 'Booking' },
  { id: '5', title: 'Cost · 7d', type: 'chart', size: '0.8KB', age: '32m', src: 'Settings' },
  { id: '6', title: 'cursor-teardown.md', type: 'doc', size: '3.2KB', age: '1d', src: 'Compete' },
  { id: '7', title: 'pricing-v2', type: 'webpage', size: '6.8KB', age: '2d', src: 'Compete' },
  { id: '8', title: 'onboarding.md', type: 'doc', size: '1.8KB', age: '3h', src: 'Onboarding' },
];

export default function Library() {
  const router = useRouter();
  const { session } = useSession();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<Item[]>(FALLBACK);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const scrollRef = useRef<ScrollView | null>(null);

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  useEffect(() => {
    return tabReTapped.on((key) => {
      if (key === 'library') {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }
    });
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const data = await getLibrary(session);
      setItems(data.items as Item[]);
      setOnline(true);
    } catch {
      setOnline(false);
    } finally {
      setLoaded(true);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = filter === 'all' ? items : items.filter((i) => i.type === filter);

  return (
    <Screen>
      <OfflineBanner online={online} onRetry={() => void load()} />

      <LargeTitleHeader
        title="Library"
        subtitle={`${items.length} items · 1.2 GB`}
        scrollY={scrollY}
      />

      <AnimatedScrollView
        ref={scrollRef as never}
        onScroll={scrollHandler as unknown as (e: NativeSyntheticEvent<NativeScrollEvent>) => void}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: space.s2,
          paddingBottom: TAB_BAR_HEIGHT + space.s5,
          gap: space.s3,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.brand}
          />
        }
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.s4, gap: 6 }}
        >
          {FILTERS.map((f) => {
            const on = f.value === filter;
            return (
              <Pressable
                key={f.value}
                onPress={() => setFilter(f.value)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                  borderRadius: radius.pill,
                  backgroundColor: on ? colors.ink : colors.surface,
                  borderWidth: 1,
                  borderColor: on ? colors.ink : colors.rule,
                }}
              >
                <Text
                  style={{
                    fontFamily: fontFamily.bodyMedium,
                    fontSize: 12.5,
                    color: on ? colors.bg : colors.ink2,
                  }}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 10,
            paddingHorizontal: space.s4,
          }}
        >
          {!loaded
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={`lt-${i}`} width="48%" height={170} borderRadius={radius.r4} />
              ))
            : filtered.map((item) => (
                <Tile
                  key={item.id}
                  item={item}
                  onPress={() =>
                    session && Linking.openURL(`${session.agentUrl}/#/library?artifact=${item.id}`)
                  }
                />
              ))}
        </View>

        {loaded && filtered.length === 0 && (
          <View style={{ paddingVertical: space.s10, alignItems: 'center', gap: space.s2 }}>
            <Ionicons name="archive-outline" size={28} color={colors.soft} />
            <Text style={{ color: colors.mute, fontFamily: fontFamily.body, fontSize: 14 }}>
              Nothing matches that filter yet.
            </Text>
          </View>
        )}
      </AnimatedScrollView>

      <TabBar
        active="library"
        onNavigate={(href) => router.push(href as never)}
        onCompose={() => router.push('/sheets/new-task' as never)}
      />
    </Screen>
  );
}

function Tile({ item, onPress }: { item: Item; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: '48%',
        backgroundColor: colors.surface,
        borderColor: colors.rule,
        borderWidth: 1,
        borderRadius: radius.r4,
        overflow: 'hidden',
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View style={{ height: 100, backgroundColor: colors.bg2, position: 'relative', overflow: 'hidden' }}>
        <TypePreview type={item.type} />
        <View
          style={{
            position: 'absolute',
            top: 6,
            left: 6,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 4,
            backgroundColor: 'rgba(14,15,18,0.78)',
          }}
        >
          <Text style={{ color: '#FFF', fontFamily: fontFamily.monoMedium, fontSize: 9, letterSpacing: 0.5 }}>
            {item.type.toUpperCase()}
          </Text>
        </View>
      </View>
      <View style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
        <Text
          style={{
            fontFamily: fontFamily.bodyMedium,
            fontSize: 12.5,
            color: colors.ink,
            letterSpacing: -0.05,
          }}
          numberOfLines={1}
        >
          {item.title}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginTop: 2,
          }}
        >
          <Mono style={{ fontSize: 10.5 }}>{item.src ?? item.size}</Mono>
          <Mono style={{ fontSize: 10.5, color: colors.soft }}>{item.age}</Mono>
        </View>
      </View>
    </Pressable>
  );
}

function TypePreview({ type }: { type: string }) {
  const { colors } = useTheme();
  if (type === 'image') {
    return (
      <LinearGradient
        colors={[colors.brand, colors.coral]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      />
    );
  }
  if (type === 'doc') {
    return (
      <View style={{ padding: 14, paddingTop: 24 }}>
        {[70, 90, 55, 82, 40].map((w, i) => (
          <View
            key={i}
            style={{
              height: 3,
              backgroundColor: i === 0 ? colors.ink3 : colors.ruleStrong,
              borderRadius: 1,
              marginBottom: 4,
              width: `${w}%`,
            }}
          />
        ))}
      </View>
    );
  }
  if (type === 'code') {
    return (
      <View style={{ flex: 1, backgroundColor: '#0E0F12', paddingVertical: 8, paddingHorizontal: 10 }}>
        {[1, 2, 3, 4, 5, 6].map((j) => (
          <View key={j} style={{ flexDirection: 'row', gap: 6, marginBottom: 2 }}>
            <Text style={{ color: 'rgba(255,255,255,0.3)', fontFamily: fontFamily.mono, fontSize: 8 }}>{j}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: fontFamily.mono, fontSize: 8 }} numberOfLines={1}>
              const session...
            </Text>
          </View>
        ))}
      </View>
    );
  }
  if (type === 'chart') {
    return (
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 3,
          padding: 10,
        }}
      >
        {[20, 45, 30, 70, 50, 28, 15].map((h, j) => (
          <View
            key={j}
            style={{
              flex: 1,
              height: `${h}%`,
              backgroundColor: colors.brand,
              opacity: 0.5 + j * 0.07,
              borderRadius: 1,
            }}
          />
        ))}
      </View>
    );
  }
  if (type === 'table') {
    return (
      <View style={{ padding: 10 }}>
        {[0, 1, 2, 3, 4].map((j) => (
          <View
            key={j}
            style={{
              flexDirection: 'row',
              gap: 3,
              paddingVertical: 2,
              borderBottomWidth: 1,
              borderBottomColor: colors.rule,
            }}
          >
            <View style={{ flex: 1, height: 3, backgroundColor: colors.ruleStrong, borderRadius: 1 }} />
            <View style={{ flex: 1, height: 3, backgroundColor: colors.ruleStrong, borderRadius: 1 }} />
            <View style={{ flex: 0.6, height: 3, backgroundColor: colors.ruleStrong, borderRadius: 1 }} />
          </View>
        ))}
      </View>
    );
  }
  if (type === 'webpage') {
    return (
      <View style={{ flex: 1, backgroundColor: '#FAFAF7' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 3,
            paddingHorizontal: 6,
            paddingVertical: 5,
            borderBottomWidth: 0.5,
            borderBottomColor: '#E5E2DA',
          }}
        >
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#E54B2C' }} />
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#F5C141' }} />
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#37C667' }} />
        </View>
        <View style={{ padding: 8 }}>
          <View style={{ height: 6, width: '50%', backgroundColor: '#111', borderRadius: 2, marginBottom: 4 }} />
          <View style={{ height: 3, backgroundColor: '#CCC', borderRadius: 1, marginBottom: 3 }} />
          <View style={{ height: 3, width: '70%', backgroundColor: '#CCC', borderRadius: 1 }} />
        </View>
      </View>
    );
  }
  return <View style={{ flex: 1 }} />;
}
