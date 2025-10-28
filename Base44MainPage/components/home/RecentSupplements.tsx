import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { SupplementCard } from '@/Base44MainPage/entities/Supplement';

const EMOJI: Record<string, string> = {
  vitamins: '💊',
  minerals: '⚡',
  probiotics: '🦠',
  omega3: '🐟',
  herbs: '🌿',
  amino_acids: '🧬',
  other: '📦',
};

export type RecentSupplementsProps = {
  supplements: SupplementCard[];
  onPressItem: (id: string) => void;
};

export function RecentSupplements({ supplements, onPressItem }: RecentSupplementsProps) {
  if (!supplements.length) {
    return (
      <TouchableOpacity activeOpacity={0.9}>
        <View style={styles.emptyList}>
          <View style={styles.emptyPlus}>
            <Text style={styles.emptyPlusText}>＋</Text>
          </View>
          <Text style={styles.emptyListTitle}>No supplements yet</Text>
          <Text style={styles.emptyListSub}>Tap + to scan your first supplement</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {supplements.slice(0, 5).map((item) => (
        <TouchableOpacity key={item.id} onPress={() => onPressItem(item.id)} activeOpacity={0.9}>
          <View style={styles.rowCard}>
            <View style={styles.rowThumb}>
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={styles.rowThumbImg} />
              ) : (
                <Text style={styles.rowEmoji}>{EMOJI[item.category] || '📦'}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.product_name}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {item.brand}
              </Text>
              {!!item.created_date && (
                <Text style={styles.rowMeta}>
                  {new Date(item.created_date).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </Text>
              )}
            </View>
            <View style={styles.rowCategory}>
              <Text style={styles.rowCategoryText}>{(item.category || '').replace(/_/g, ' ')}</Text>
            </View>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rowCard: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  rowThumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowThumbImg: { width: 56, height: 56, borderRadius: 12 },
  rowEmoji: { fontSize: 28 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  rowSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  rowMeta: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  rowCategory: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#f3f4f6',
    borderRadius: 999,
    marginLeft: 8,
  },
  rowCategoryText: { fontSize: 11, color: '#4b5563' },
  emptyList: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
    borderWidth: 1.2,
    borderColor: '#d1d5db',
  },
  emptyPlus: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyPlusText: { fontSize: 28, color: '#9ca3af' },
  emptyListTitle: { color: '#6b7280', fontWeight: '600', marginBottom: 4 },
  emptyListSub: { color: '#9ca3af', fontSize: 12 },
});

export default RecentSupplements;
