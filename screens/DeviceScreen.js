import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { moderateScale, fontScale } from '../utils/responsive';
import { useFarms } from '../contexts/FarmContext';
import { useTheme } from '../contexts/ThemeContext';

export default function DeviceScreen() {
  const navigation = useNavigation();
  const {
    farms,
    isLoading: farmsLoading,
    error: farmsError,
    addFarm,
    editFarm,
    removeFarm,
  } = useFarms();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, insets), [theme, insets]);

  const [searchQuery, setSearchQuery] = useState('');
  const [addFarmModalVisible, setAddFarmModalVisible] = useState(false);
  const [editFarmModalVisible, setEditFarmModalVisible] = useState(false);
  const [farmName, setFarmName] = useState('');
  const [farmDescription, setFarmDescription] = useState('');
  const [editingFarm, setEditingFarm] = useState(null);
  const [farmSubmitting, setFarmSubmitting] = useState(false);
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' for A-Z, 'desc' for Z-A

  useEffect(() => {
    if (farmsError) {
      Alert.alert('Farm Service Error', farmsError);
    }
  }, [farmsError]);

  const filteredAndSortedFarms = useMemo(() => {
    // First filter by search query
    let filtered = farms;
    if (searchQuery.trim()) {
      const lowered = searchQuery.trim().toLowerCase();
      filtered = farms.filter(
        (farm) =>
          farm.name.toLowerCase().includes(lowered) ||
          (farm.address && farm.address.toLowerCase().includes(lowered)) ||
          (farm.description && farm.description.toLowerCase().includes(lowered))
      );
    }

    // Then sort by name
    const sorted = [...filtered].sort((a, b) => {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();
      if (sortOrder === 'asc') {
        return nameA.localeCompare(nameB);
      } else {
        return nameB.localeCompare(nameA);
      }
    });

    return sorted;
  }, [farms, searchQuery, sortOrder]);

  const handleAddFarm = async () => {
    if (!farmName.trim()) {
      Alert.alert('Validation', 'Please enter a farm name');
      return;
    }

    setFarmSubmitting(true);
    try {
      await addFarm({
        name: farmName.trim(),
        description: farmDescription?.trim() ?? '',
      });
      setFarmName('');
      setFarmDescription('');
      setAddFarmModalVisible(false);
      Alert.alert('Success', 'Farm added successfully!');
    } catch (error) {
      Alert.alert('Unable to Add Farm', error?.message || 'Please try again.');
    } finally {
      setFarmSubmitting(false);
    }
  };

  const handleEditFarm = (farm) => {
    setEditingFarm(farm);
    setFarmName(farm.name);
    setFarmDescription(farm.address || farm.description || '');
    setEditFarmModalVisible(true);
  };

  const handleUpdateFarm = async () => {
    if (!farmName.trim()) {
      Alert.alert('Validation', 'Please enter a farm name');
      return;
    }

    setFarmSubmitting(true);
    try {
      await editFarm({
        farmId: editingFarm.id,
        name: farmName.trim(),
        description: farmDescription?.trim() ?? '',
      });
      setEditFarmModalVisible(false);
      setEditingFarm(null);
      setFarmName('');
      setFarmDescription('');
      Alert.alert('Success', 'Farm updated successfully!');
    } catch (error) {
      Alert.alert('Unable to Update Farm', error?.message || 'Please try again.');
    } finally {
      setFarmSubmitting(false);
    }
  };

  const handleDeleteFarm = (farm) => {
    Alert.alert('Delete Farm', `Are you sure you want to delete "${farm.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setFarmSubmitting(true);
          try {
            await removeFarm(farm.id);
            Alert.alert('Success', 'Farm deleted successfully!');
          } catch (error) {
            Alert.alert('Unable to Delete Farm', error?.message || 'Please try again later.');
          } finally {
            setFarmSubmitting(false);
          }
        },
      },
    ]);
  };

  const handleAddModule = (farm) => {
    navigation.navigate('ModuleScreen', {
      farmId: farm.id,
    });
  };

  const handleCloseModal = () => {
    setAddFarmModalVisible(false);
    setFarmName('');
    setFarmDescription('');
  };

  const handleCloseEditModal = () => {
    setEditFarmModalVisible(false);
    setEditingFarm(null);
    setFarmName('');
    setFarmDescription('');
  };

  const placeholderColor = theme.colors.mutedText;

  const renderFarmCard = (farm) => {
    const farmAddress = farm.address || farm.description || 'No description provided';
    return (
      <View key={farm.id} style={styles.farmCard}>
        <View style={styles.farmCardContent}>
          <View style={styles.farmIconContainer}>
            <Image source={require('../assets/adaptive-icon.png')} style={styles.farmIcon} />
          </View>
          <View style={styles.farmInfo}>
            <Text style={styles.farmName}>{farm.name}</Text>
            <Text style={styles.farmAddress}>{farmAddress}</Text>
          </View>
        </View>
        <View style={styles.farmActions}>
          <TouchableOpacity style={styles.actionButton} onPress={() => handleAddModule(farm)}>
            <Ionicons name="add-circle" size={moderateScale(20)} color={theme.colors.accent} />
            <Text style={styles.actionButtonText}>Module</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => handleEditFarm(farm)}>
            <Ionicons name="create" size={moderateScale(20)} color={theme.colors.accentSecondary} />
            <Text style={styles.actionButtonText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => handleDeleteFarm(farm)}>
            <Ionicons name="trash" size={moderateScale(20)} color={theme.colors.danger} />
            <Text style={styles.actionButtonText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Farm Locations</Text>
        </View>

        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Ionicons
              name="search"
              size={moderateScale(20)}
              color={theme.colors.mutedText}
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search farm..."
              placeholderTextColor={placeholderColor}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
                <TouchableOpacity
            style={[styles.addFarmButton, farmSubmitting && styles.disabledButton]}
            onPress={() => setAddFarmModalVisible(true)}
            disabled={farmSubmitting}
                >
            <Ionicons name="add" size={moderateScale(20)} color={theme.colors.surface} />
            <Text style={styles.addFarmText}>Add Farm</Text>
                </TouchableOpacity>
              </View>

        <View style={styles.farmsHeader}>
          <Text style={styles.farmsTitle}>My Farms</Text>
          <TouchableOpacity 
            style={styles.sortButton} 
            onPress={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          >
            <Text style={styles.sortText}>
              Sort by Name {sortOrder === 'asc' ? '(A-Z)' : '(Z-A)'}
            </Text>
            <Ionicons 
              name={sortOrder === 'asc' ? 'chevron-down' : 'chevron-up'} 
              size={moderateScale(16)} 
              color={theme.colors.mutedText} 
            />
          </TouchableOpacity>
            </View>

        {farmsLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.accent} />
            <Text style={styles.loadingText}>Loading farms...</Text>
          </View>
        )}

        {!farmsLoading && filteredAndSortedFarms.length === 0 && (
          <View style={styles.emptyStateContainer}>
            <Ionicons name="leaf-outline" size={moderateScale(48)} color={theme.colors.mutedText} />
            <Text style={styles.emptyStateText}>
              {searchQuery.trim() ? 'No farms found matching your search.' : 'No farms found. Add a new farm to get started!'}
            </Text>
          </View>
        )}

        {!farmsLoading && filteredAndSortedFarms.map(renderFarmCard)}
      </ScrollView>

      <Modal
        visible={addFarmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Farm</Text>
              <TouchableOpacity onPress={handleCloseModal}>
                <Ionicons name="close" size={moderateScale(24)} color={theme.colors.icon} />
              </TouchableOpacity>
                  </View>

            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Farm Name</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  placeholder="Enter farm name"
                  placeholderTextColor={placeholderColor}
                  value={farmName}
                  onChangeText={setFarmName}
                />
                </View>
              </View>

            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Description</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Enter farm description"
                  placeholderTextColor={placeholderColor}
                  value={farmDescription}
                  onChangeText={setFarmDescription}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
                </View>
              </View>

            <TouchableOpacity
              style={[
                styles.modalPrimaryButton,
                farmSubmitting && styles.disabledButton,
              ]}
              onPress={handleAddFarm}
              disabled={farmSubmitting}
            >
              <Text style={styles.modalPrimaryButtonText}>
                {farmSubmitting ? 'Saving...' : 'Add'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={editFarmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseEditModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Farm</Text>
              <TouchableOpacity onPress={handleCloseEditModal}>
                <Ionicons name="close" size={moderateScale(24)} color={theme.colors.icon} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Farm Name</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  placeholder="Enter farm name"
                  placeholderTextColor={placeholderColor}
                  value={farmName}
                  onChangeText={setFarmName}
                />
              </View>
            </View>

            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Description</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Enter farm description"
                  placeholderTextColor={placeholderColor}
                  value={farmDescription}
                  onChangeText={setFarmDescription}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.modalPrimaryButton,
                farmSubmitting && styles.disabledButton,
              ]}
              onPress={handleUpdateFarm}
              disabled={farmSubmitting}
            >
              <Text style={styles.modalPrimaryButtonText}>
                {farmSubmitting ? 'Saving...' : 'Update'}
              </Text>
            </TouchableOpacity>
          </View>
          </View>
      </Modal>
      </SafeAreaView>
  );
}

const createStyles = (theme, insets) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollView: {
      flex: 1,
  },
    container: {
      flexGrow: 1,
      padding: moderateScale(16),
      paddingBottom: moderateScale(100) + insets.bottom,
  },
    header: {
      alignItems: 'center',
      marginBottom: moderateScale(20),
    },
    headerTitle: {
      fontSize: fontScale(20),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
    },
    searchContainer: {
      flexDirection: 'row',
      marginBottom: moderateScale(20),
      gap: moderateScale(12),
  },
    searchBar: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      paddingHorizontal: moderateScale(16),
      paddingVertical: moderateScale(12),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    searchIcon: {
      marginRight: moderateScale(8),
    },
    searchInput: {
    flex: 1,
      color: theme.colors.primaryText,
      fontSize: fontScale(14),
      padding: 0,
  },
    addFarmButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(12),
      paddingHorizontal: moderateScale(16),
      paddingVertical: moderateScale(12),
      gap: moderateScale(8),
    },
    addFarmText: {
      color: theme.colors.surface,
      fontSize: fontScale(14),
      fontWeight: 'bold',
    },
    farmsHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: moderateScale(16),
    },
    farmsTitle: {
      fontSize: fontScale(18),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
    },
    sortButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(8),
      paddingHorizontal: moderateScale(12),
      paddingVertical: moderateScale(8),
      gap: moderateScale(6),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    sortText: {
      fontSize: fontScale(12),
      color: theme.colors.mutedText,
    },
    loadingContainer: {
      alignItems: 'center',
    justifyContent: 'center', 
      paddingVertical: moderateScale(40),
      gap: moderateScale(12),
  },
    loadingText: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
    },
    emptyStateContainer: {
      alignItems: 'center',
    justifyContent: 'center', 
      paddingVertical: moderateScale(40),
      gap: moderateScale(12),
    },
    emptyStateText: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
      textAlign: 'center',
      paddingHorizontal: moderateScale(24),
    },
    farmCard: {
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      padding: moderateScale(16),
      marginBottom: moderateScale(12),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    farmCardContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    farmIconContainer: {
      width: moderateScale(48),
      height: moderateScale(48),
      alignItems: 'center',
    justifyContent: 'center',
      marginRight: moderateScale(16),
      borderRadius: moderateScale(12),
      backgroundColor: theme.colors.subtleCard,
    },
    farmIcon: {
      width: '100%',
      height: '100%',
      resizeMode: 'contain',
    },
    farmInfo: {
      flex: 1,
    },
    farmName: {
      fontSize: fontScale(16),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(4),
    },
    farmAddress: {
      fontSize: fontScale(14),
      color: theme.colors.mutedText,
    },
    farmActions: {
      flexDirection: 'row',
      marginTop: moderateScale(12),
      gap: moderateScale(8),
    },
    actionButton: {
      flex: 1,
      flexDirection: 'row',
    alignItems: 'center', 
      justifyContent: 'center',
      backgroundColor: theme.colors.subtleCard,
      borderRadius: moderateScale(8),
      paddingVertical: moderateScale(10),
      gap: moderateScale(4),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    actionButtonText: {
      fontSize: fontScale(12),
      color: theme.colors.primaryText,
      fontWeight: '500',
  },
    modalOverlay: {
      flex: 1,
      backgroundColor: theme.colors.overlay,
    justifyContent: 'center', 
    alignItems: 'center', 
      padding: moderateScale(20),
    },
    modalCard: {
      width: '85%',
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(20),
      padding: moderateScale(24),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: moderateScale(24),
  },
    modalTitle: {
      fontSize: fontScale(20),
      fontWeight: 'bold',
      color: theme.colors.primaryText,
    },
    inputWrapper: {
      marginBottom: moderateScale(20),
  },
    inputLabel: {
      fontSize: fontScale(14),
      fontWeight: '500',
      color: theme.colors.primaryText,
      marginBottom: moderateScale(8),
  },
    inputContainer: {
      backgroundColor: theme.colors.subtleCard,
      borderRadius: moderateScale(12),
      paddingHorizontal: moderateScale(16),
      paddingVertical: moderateScale(12),
      borderWidth: 1,
      borderColor: theme.colors.border,
  },
    input: {
      color: theme.colors.primaryText,
      fontSize: fontScale(16),
      padding: 0,
    },
    textArea: {
      minHeight: moderateScale(100),
      paddingTop: moderateScale(12),
  },
    modalPrimaryButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: moderateScale(12),
      paddingVertical: moderateScale(16),
      alignItems: 'center',
      marginTop: moderateScale(8),
  },
    modalPrimaryButtonText: {
      color: theme.colors.surface,
      fontSize: fontScale(18),
      fontWeight: 'bold',
    },
    disabledButton: {
      opacity: 0.6,
  },
});
