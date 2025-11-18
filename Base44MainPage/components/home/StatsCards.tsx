import React, { useMemo, useRef, useState } from 'react';
import { Dimensions, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { SupplementCard } from '@/Base44MainPage/entities/Supplement';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export type StatsCardsProps = {
  supplements: SupplementCard[];
  onPressCard: (id: string) => void;
};

const EMOJI: Record<string, string> = {
  vitamins: '💊',
  minerals: '⚡',
  probiotics: '🦠',
  omega3: '🐟',
  herbs: '🌿',
  amino_acids: '🧬',
  other: '📦',
};

export function StatsCards({ supplements, onPressCard }: StatsCardsProps) {
  const cardWidth = SCREEN_WIDTH - 32;
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const hasMultiple = supplements.length > 1;
  const cards = useMemo(() => supplements, [supplements]);

  if (cards.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyEmoji}>📦</Text>
        <Text style={styles.emptyTitle}>No favourites yet</Text>
        <Text style={styles.emptySub}>Scan supplements to add them to your favourites</Text>
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 10, paddingHorizontal: 16 }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={(event) => {
          const x = event.nativeEvent.contentOffset.x;
          const nextIndex = Math.round(x / cardWidth);
          setIndex(nextIndex);
        }}
        scrollEventThrottle={16}
        style={styles.scrollContainer}
      >
        {cards.map((item, i) => (
          <TouchableOpacity
            key={item.id}
            activeOpacity={0.9}
            onPress={() => onPressCard(item.id)}
            style={[styles.card, { width: cardWidth, marginLeft: i === 0 ? 0 : 12, marginRight: 0 }]}
          >
            <View style={styles.bookmark}>
              <LinearGradient colors={['#34d399', '#10b981']} style={styles.bookmarkBadge}>
                <Text style={styles.bookmarkStar}>★</Text>
              </LinearGradient>
            </View>

            <View style={styles.productThumb}>
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={styles.thumbImg} />
              ) : (
                <Text style={styles.thumbEmoji}>{EMOJI[item.category] || '📦'}</Text>
              )}
            </View>

            <Text style={styles.cardTitle}>{item.product_name}</Text>
            <Text style={styles.cardSub}>{item.brand}</Text>

            <View style={styles.badge}>
              <Text style={styles.badgeText}>Main ingredient • 500 mg</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {hasMultiple && (
        <View style={styles.dotsRow}>
          {cards.map((_, i) => (
            <View key={i} style={[styles.dot, i === index ? styles.dotActive : null]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    backgroundColor: 'transparent',
  },
  card: {
    backgroundColor: '#F9FAFB',
    borderRadius: 22,
    padding: 20,
    minHeight: 220,
    justifyContent: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.04)',
  },
  bookmark: {
    position: 'absolute',
    right: 16,
    top: 14,
  },
  bookmarkBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookmarkStar: { color: '#fff', fontWeight: '700' },
  productThumb: {
    width: 96,
    height: 96,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  thumbImg: { width: 96, height: 96, borderRadius: 20 },
  thumbEmoji: { fontSize: 44 },
  cardTitle: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 6 },
  cardSub: { color: '#6b7280', fontSize: 15, marginBottom: 14 },
  badge: {
    backgroundColor: '#ecfdf5',
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  badgeText: { color: '#059669', fontWeight: '600', fontSize: 12 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 12, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d1d5db' },
  dotActive: { width: 18, backgroundColor: '#10b981' },
  emptyCard: {
    marginHorizontal: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.04)',
  },
  emptyEmoji: { fontSize: 44, marginBottom: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 6 },
  emptySub: { color: '#6b7280' },
});

export default StatsCards;
