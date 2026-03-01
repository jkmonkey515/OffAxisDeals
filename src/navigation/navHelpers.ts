import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { CommonActions } from '@react-navigation/native';
import type { AppStackParamList } from '../types/navigation';

/**
 * Safely walks up the navigation hierarchy to find the root navigator
 * @param navigation - The navigation object from any nested navigator
 * @returns The root navigation object, or the original if no parent exists
 */
export function getRootNavigator(
  navigation: NavigationProp<ParamListBase>
): NavigationProp<ParamListBase> {
  let current: NavigationProp<ParamListBase> | undefined = navigation;
  
  // Walk up the parent chain until we reach the root
  while (current?.getParent) {
    const parent: NavigationProp<ParamListBase> | undefined = current.getParent();
    if (parent) {
      current = parent;
    } else {
      break;
    }
  }
  
  return current ?? navigation;
}

/**
 * Resets navigation to SavedSearchesHome screen
 * This ensures we always land on the list, regardless of navigation history
 * @param navigation - The navigation object from any nested navigator
 */
export function resetToSavedSearchesHome(
  navigation: NavigationProp<ParamListBase>
): void {
  const rootNav = getRootNavigator(navigation);
  
  // Reset the navigation stack to: Tabs > SavedSearches > SavedSearchesHome
  rootNav.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [
        {
          name: 'Tabs',
          state: {
            routes: [
              {
                name: 'SavedSearches',
                state: {
                  routes: [{ name: 'SavedSearchesHome' }],
                  index: 0,
                },
              },
            ],
            index: 0,
          },
        },
      ],
    })
  );
}
