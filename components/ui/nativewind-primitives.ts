import type { ComponentType } from 'react';
import {
  ActivityIndicator as RNActivityIndicator,
  FlatList as RNFlatList,
  Image as RNImage,
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Modal as RNModal,
  Pressable as RNPressable,
  RefreshControl as RNRefreshControl,
  ScrollView as RNScrollView,
  SectionList as RNSectionList,
  Text as RNText,
  TextInput as RNTextInput,
  TouchableHighlight as RNTouchableHighlight,
  TouchableOpacity as RNTouchableOpacity,
  TouchableWithoutFeedback as RNTouchableWithoutFeedback,
  View as RNView,
} from 'react-native';

type Primitive = ComponentType<any>;

export const View = RNView as unknown as Primitive;
export const Text = RNText as unknown as Primitive;
export const ScrollView = RNScrollView as unknown as Primitive;
export const Pressable = RNPressable as unknown as Primitive;
export const Modal = RNModal as unknown as Primitive;
export const Image = RNImage as unknown as Primitive;
export const ActivityIndicator = RNActivityIndicator as unknown as Primitive;
export const RefreshControl = RNRefreshControl as unknown as Primitive;
export const KeyboardAvoidingView = RNKeyboardAvoidingView as unknown as Primitive;
export const TextInput = RNTextInput as unknown as Primitive;
export const TouchableOpacity = RNTouchableOpacity as unknown as Primitive;
export const TouchableWithoutFeedback = RNTouchableWithoutFeedback as unknown as Primitive;
export const TouchableHighlight = RNTouchableHighlight as unknown as Primitive;
export const FlatList = RNFlatList as unknown as Primitive;
export const SectionList = RNSectionList as unknown as Primitive;

export type {
  ViewProps,
  TextProps,
  ScrollViewProps,
  PressableProps,
  ModalProps,
  ImageProps,
  ActivityIndicatorProps,
  RefreshControlProps,
  KeyboardAvoidingViewProps,
  TextInputProps,
  TouchableOpacityProps,
  TouchableWithoutFeedbackProps,
  TouchableHighlightProps,
  FlatListProps,
  SectionListProps,
} from 'react-native';
