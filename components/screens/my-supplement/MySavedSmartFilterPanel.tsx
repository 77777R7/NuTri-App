import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { X, Check, Plus, SlidersHorizontal } from "lucide-react-native";
import { AnimatePresence, MotiView } from "moti";
import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type SmartFilterTagCategory = {
  title: string;
  activeColor: { bg: string; text: string; border: string };
  tags: string[];
};

type Props = {
  variant: "inline" | "overlay";
  styles: Record<string, any>;
  filterWrapRef: React.RefObject<View | null>;
  filterScrollRef: React.RefObject<ScrollView | null>;
  isVisible: boolean;
  filterAnchorRight: number;
  filterAnchorY?: number;
  contentWidth: number;
  filterOpenHeight: number;
  filterCollapsedSize: number;
  filterWidthDuration: number;
  filterHeightDuration: number;
  filterEasing: any;
  filterState: "closed" | "opening" | "open" | "closing";
  filterContentVisible: boolean;
  filterContentActive: boolean;
  showFilterCollapsed: boolean;
  filterIconShift: number;
  highlightedGoalTag: string | null;
  smartTagCategories: SmartFilterTagCategory[];
  activeTags: Set<string>;
  userTags: string[];
  isCreatingTag: boolean;
  newTagText: string;
  keyboardHeight: number;
  topInset: number;
  onOpen: () => void;
  onClose: () => void;
  onToggleTag: (tag: string) => void;
  onDeleteTag: (tag: string) => void;
  onStartCreatingTag: () => void;
  onCancelCreatingTag: () => void;
  onCreateTag: () => void;
  onChangeNewTagText: (value: string) => void;
  onClearAll: () => void;
};

export function MySavedSmartFilterPanel({
  variant,
  styles,
  filterWrapRef,
  filterScrollRef,
  isVisible,
  filterAnchorRight,
  filterAnchorY,
  contentWidth,
  filterOpenHeight,
  filterCollapsedSize,
  filterWidthDuration,
  filterHeightDuration,
  filterEasing,
  filterState,
  filterContentVisible,
  filterContentActive,
  showFilterCollapsed,
  filterIconShift,
  highlightedGoalTag,
  smartTagCategories,
  activeTags,
  userTags,
  isCreatingTag,
  newTagText,
  keyboardHeight,
  topInset,
  onOpen,
  onClose,
  onToggleTag,
  onDeleteTag,
  onStartCreatingTag,
  onCancelCreatingTag,
  onCreateTag,
  onChangeNewTagText,
  onClearAll,
}: Props) {
  const isOverlay = variant === "overlay";

  return (
    <MotiView
      ref={isOverlay ? undefined : filterWrapRef}
      shouldRasterizeIOS
      renderToHardwareTextureAndroid
      from={{
        width: filterCollapsedSize,
        height: filterCollapsedSize,
        borderRadius: 27,
        backgroundColor: "#E4E7EB",
        borderColor: "rgba(255,255,255,0)",
      }}
      style={[
        styles.filterWrap,
        isOverlay && filterAnchorY != null
          ? {
              right: filterAnchorRight,
              top: filterAnchorY,
            }
          : null,
      ]}
      animate={{
        width: filterState === "closed" ? filterCollapsedSize : contentWidth,
        height: filterState === "open" ? filterOpenHeight : filterCollapsedSize,
        borderRadius: filterState === "closed" ? 27 : 32,
        backgroundColor: filterState === "closed" ? "#E4E7EB" : "rgba(255,255,255,0.72)",
        borderColor: filterState === "closed" ? "rgba(255,255,255,0)" : "rgba(255,255,255,0.5)",
        opacity: isVisible ? 1 : 0,
      }}
      transition={{
        width: { type: "timing", duration: filterWidthDuration, easing: filterEasing },
        height: { type: "timing", duration: filterHeightDuration, easing: filterEasing },
        borderRadius: { type: "timing", duration: 240, easing: filterEasing },
        backgroundColor: { type: "timing", duration: 220, easing: filterEasing },
        borderColor: { type: "timing", duration: 220, easing: filterEasing },
        opacity: { type: "timing", duration: 180, easing: filterEasing },
      }}
      pointerEvents={isVisible ? "auto" : "none"}
    >
      <AnimatePresence>
        {filterContentVisible ? (
          <MotiView
            key="filter-open"
            shouldRasterizeIOS
            renderToHardwareTextureAndroid
            animate={{
              opacity: filterContentActive ? 1 : 0,
              translateY: filterContentActive ? 0 : 6,
            }}
            transition={{ type: "timing", duration: 200 }}
            style={styles.filterInner}
            pointerEvents={filterContentActive ? "auto" : "none"}
          >
            <BlurView intensity={36} tint="light" style={StyleSheet.absoluteFillObject} />
            <View style={styles.filterInnerTint} pointerEvents="none" />
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(255,255,255,0.70)", "rgba(255,255,255,0.28)", "rgba(255,255,255,0)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={styles.filterInnerBorder} pointerEvents="none" />

            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : "height"}
              keyboardVerticalOffset={Math.max(0, (filterAnchorY ?? topInset) + 120)}
              style={styles.filterKeyboard}
            >
              <MotiView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: "timing", duration: 200 }}
                style={styles.filterHeader}
              >
                <View>
                  <Text style={styles.filterTitle}>Smart Filter</Text>
                  <Text style={styles.filterSubtitle}>
                    {highlightedGoalTag ? `Suggested focus: ${highlightedGoalTag}` : "Categorize your stack"}
                  </Text>
                </View>
                <Pressable onPress={onClose} style={styles.filterCloseBtn}>
                  <X size={20} color="#475569" />
                </Pressable>
              </MotiView>

              <ScrollView
                ref={filterScrollRef}
                style={styles.filterContent}
                showsVerticalScrollIndicator={false}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[
                  styles.filterContentInner,
                  { paddingBottom: Math.max(24, keyboardHeight + 12) },
                ]}
              >
                {smartTagCategories.map((category, index) => (
                  <MotiView
                    key={category.title}
                    from={{ opacity: 0, translateY: 12 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ type: "timing", duration: 240, delay: 120 + index * 60 }}
                    style={styles.filterSection}
                  >
                    <View style={styles.filterSectionHeader}>
                      <View
                        style={[
                          styles.filterDot,
                          {
                            backgroundColor: category.activeColor.bg,
                            borderColor: category.activeColor.border,
                          },
                        ]}
                      />
                      <Text style={styles.filterSectionTitle}>{category.title}</Text>
                    </View>
                    <View style={styles.filterTagsRow}>
                      {category.tags.map((tag) => {
                        const isActive = activeTags.has(tag);
                        return (
                          <Pressable
                            key={tag}
                            onPress={() => onToggleTag(tag)}
                            style={[
                              styles.filterTag,
                              isActive
                                ? {
                                    backgroundColor: category.activeColor.bg,
                                    borderColor: category.activeColor.border,
                                  }
                                : {
                                    backgroundColor: "#ffffff",
                                    borderColor: "#e2e8f0",
                                  },
                            ]}
                          >
                            <Text
                              style={[
                                styles.filterTagText,
                                { color: isActive ? category.activeColor.text : "#475569" },
                              ]}
                            >
                              {tag}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </MotiView>
                ))}

                <MotiView
                  from={{ opacity: 0, translateY: 12 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: "timing", duration: 240, delay: 380 }}
                  style={styles.filterSection}
                >
                  <View style={styles.filterSectionHeader}>
                    <View style={[styles.filterDot, styles.filterDotNeutral]} />
                    <Text style={styles.filterSectionTitle}>My Tags</Text>
                  </View>

                  <View style={styles.filterTagsRow}>
                    {userTags.map((tag) => {
                      const isActive = activeTags.has(tag);
                      return (
                        <View key={tag} style={styles.userTagWrap}>
                          <Pressable
                            onPress={() => onToggleTag(tag)}
                            style={[
                              styles.userTag,
                              isActive
                                ? {
                                    backgroundColor: "rgba(100,116,139,0.15)",
                                    borderColor: "rgba(148,163,184,0.5)",
                                  }
                                : {
                                    backgroundColor: "#ffffff",
                                    borderColor: "#e2e8f0",
                                  },
                            ]}
                          >
                            <Text style={[styles.userTagText, isActive && { color: "#1e293b" }]}>{tag}</Text>
                          </Pressable>
                          <Pressable
                            onPress={(event) => {
                              event.stopPropagation();
                              onDeleteTag(tag);
                            }}
                            style={styles.userTagDelete}
                          >
                            <X size={13} color={isActive ? "#64748b" : "#94a3b8"} />
                          </Pressable>
                        </View>
                      );
                    })}

                    {!isCreatingTag ? (
                      <Pressable
                        onPress={() => {
                          onStartCreatingTag();
                          requestAnimationFrame(() => filterScrollRef.current?.scrollToEnd({ animated: true }));
                        }}
                        style={styles.newTagBtn}
                      >
                        <Plus size={14} color="#94a3b8" />
                        <Text style={styles.newTagText}>New Tag</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.newTagInputRow}>
                        <TextInput
                          autoFocus
                          value={newTagText}
                          onChangeText={onChangeNewTagText}
                          placeholder="Tag name..."
                          placeholderTextColor="#94a3b8"
                          onSubmitEditing={onCreateTag}
                          onFocus={() => filterScrollRef.current?.scrollToEnd({ animated: true })}
                          style={styles.newTagInput}
                        />
                        <Pressable onPress={onCreateTag} style={styles.newTagConfirm}>
                          <Check size={14} color="#ffffff" />
                        </Pressable>
                        <Pressable onPress={onCancelCreatingTag} style={styles.newTagCancel}>
                          <X size={14} color="#64748b" />
                        </Pressable>
                      </View>
                    )}
                  </View>
                </MotiView>
              </ScrollView>

              <MotiView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: "timing", duration: 200, delay: 280 }}
                style={styles.filterFooter}
              >
                <Text style={styles.filterFooterText}>
                  {activeTags.size > 0 ? `${activeTags.size} selected` : "No filters"}
                </Text>
                {activeTags.size > 0 ? (
                  <Pressable onPress={onClearAll} style={styles.clearFiltersBtn}>
                    <Text style={styles.clearFiltersText}>Clear All</Text>
                  </Pressable>
                ) : null}
              </MotiView>
            </KeyboardAvoidingView>
          </MotiView>
        ) : null}
      </AnimatePresence>

      <MotiView
        style={styles.filterCollapsedOverlay}
        animate={
          showFilterCollapsed
            ? { opacity: 1, translateX: 0, scale: 1 }
            : { opacity: 0, translateX: -filterIconShift, scale: 0.94 }
        }
        transition={{
          opacity: { type: "timing", duration: 360, easing: filterEasing },
          translateX: { type: "timing", duration: filterWidthDuration, easing: filterEasing },
          scale: { type: "timing", duration: filterWidthDuration, easing: filterEasing },
        }}
        pointerEvents={filterState === "closed" ? "auto" : "none"}
      >
        <Pressable style={styles.filterCollapsedButton} onPress={onOpen}>
          <SlidersHorizontal size={18} color="#0f172a" />
        </Pressable>
      </MotiView>
    </MotiView>
  );
}
