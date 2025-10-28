import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Heart } from 'lucide-react-native';
import { router, type Href } from 'expo-router';
import { Image } from '@/components/ui/nativewind-primitives';

const categoryEmojis: Record<string, string> = {
  vitamins: '💊',
  minerals: '⚡',
  probiotics: '🦠',
  omega3: '🐟',
  herbs: '🌿',
  amino_acids: '🧬',
  other: '📦',
};

export default function FavouritePage() {
  const supplements: any[] = [];
  const isLoading = false;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.replace('/main')} activeOpacity={0.85} style={styles.backButton}>
            <ArrowLeft size={20} color="#374151" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Favourite Supplements</Text>
            <Text style={styles.subtitle}>{supplements.length} active supplements</Text>
          </View>
        </View>

        {isLoading ? (
          <View style={styles.loaderList}>
            {[0, 1, 2, 3].map(index => (
              <View key={index} style={styles.skeletonCard}>
                <View style={styles.skeletonRow}>
                  <View style={styles.skeletonThumb} />
                  <View style={styles.skeletonBody}>
                    <View style={[styles.skeletonLine, { width: '75%' }]} />
                    <View style={[styles.skeletonLine, { width: '55%', marginTop: 10 }]} />
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : supplements.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Heart size={44} color="#CBD5F5" />
            </View>
            <Text style={styles.emptyTitle}>No favourites yet</Text>
            <Text style={styles.emptySubtitle}>
              Start scanning supplements to add them to your favourites
            </Text>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => router.push('/(tabs)/scan')}
              style={styles.emptyButton}
            >
              <Text style={styles.emptyButtonText}>Scan Your First</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.listContainer}>
            {supplements.map((supplement, index) => (
              <TouchableOpacity
                key={supplement.id ?? index}
                activeOpacity={0.9}
                onPress={() => {
                  if (!supplement.id) {
                    return;
                  }
                  router.push(`/supplement?id=${supplement.id}` as Href);
                }}
              >
                <View style={styles.itemCard}>
                  <View style={styles.itemThumbnail}>
                    {supplement.image_url ? (
                      <Image source={{ uri: supplement.image_url }} style={styles.itemThumbnailImage} />
                    ) : (
                      <Text style={styles.itemThumbnailEmoji}>
                        {categoryEmojis[supplement.category ?? ''] ?? '📦'}
                      </Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {supplement.product_name}
                    </Text>
                    <Text style={styles.itemSubtitle} numberOfLines={1}>
                      {supplement.brand}
                    </Text>
                    {supplement.created_date ? (
                      <Text style={styles.itemMeta}>
                        Added{' '}
                        {new Date(supplement.created_date).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </Text>
                    ) : null}
                  </View>
                  <Heart size={24} color="#ef4444" fill="#ef4444" />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 24,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 32,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#111827',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  loaderList: {
    gap: 14,
  },
  skeletonCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  skeletonThumb: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#E2E8F0',
  },
  skeletonBody: {
    flex: 1,
    gap: 8,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 36,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 32,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  emptyButton: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: '#111827',
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  listContainer: {
    gap: 16,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  itemThumbnail: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemThumbnailImage: {
    width: 56,
    height: 56,
    borderRadius: 14,
  },
  itemThumbnailEmoji: {
    fontSize: 28,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  itemSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  itemMeta: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
});
