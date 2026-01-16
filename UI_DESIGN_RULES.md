# UI Design Rules and Guidelines

This document outlines the general UI/UX design rules and patterns used throughout the application. Reference this file when making UI changes to maintain consistency.

## General Principles

1. **No Absolute Positioning**: Never use `position: absolute` for layout elements. Use flexbox, grid, or relative positioning instead.

2. **Responsive Design**: All components should be mobile-first and responsive. Use Tailwind's responsive breakpoints (`sm:`, `md:`, `lg:`) appropriately.

3. **Dark Mode Support**: All components must support dark mode using Tailwind's `dark:` prefix. Ensure text, backgrounds, and borders have appropriate dark mode variants.

## Button Sizing and Styling

### Standard Button Sizes

- **Small Buttons** (used in headers, filters, action bars):
  - Class: `text-sm px-3 py-1.5`
  - Icon size: `16px`
  - Gap between icon and text: `gap-1` (0.25rem)
  - Example: Filter buttons, "New Group" button, "Clear" button

- **Medium Buttons** (used in forms, modals):
  - Default Button component styling
  - Icon size: `18-20px`
  - Gap between icon and text: `gap-2` (0.5rem)

- **Large Buttons** (used for primary actions):
  - Larger padding and text size
  - Icon size: `20-24px`

### Button Variants

- **Primary** (`variant="primary"`): Green/primary color, used for main actions
- **Secondary** (`variant="secondary"`): Gray, used for secondary actions
- **Danger** (`variant="danger"`): Red, used for destructive actions

### Button Consistency

- When buttons appear side-by-side (e.g., in headers), they should have the same size classes
- Use `flex items-center gap-1` or `gap-2` for buttons with icons
- Icon size should be consistent within the same context (e.g., all header buttons use `size={16}`)

## Color Scheme

### Text Colors

- **Primary Text**: `text-gray-900 dark:text-white`
- **Secondary Text**: `text-gray-600 dark:text-gray-400` or `text-gray-500 dark:text-gray-400`
- **Muted Text**: `text-gray-400 dark:text-gray-500`
- **Error Text**: `text-red-600 dark:text-red-400`
- **Success Text**: `text-green-600 dark:text-green-400`

### Background Colors

- **Card Background**: `bg-white dark:bg-gray-800`
- **Page Background**: `bg-gray-50 dark:bg-gray-900`
- **Input Background**: `bg-white dark:bg-gray-800`
- **Hover States**: Use appropriate hover colors with `hover:` prefix

### Border Colors

- **Default Borders**: `border-gray-300 dark:border-gray-600`
- **Focus Borders**: Use primary color with focus ring

## Spacing and Layout

### Padding

- **Card Padding**: Standard padding in cards
- **Section Padding**: `pb-24` for main content areas to prevent navbar overlap
- **Input Padding**: `px-3 py-1.5` for small inputs, `px-4 py-2` for standard inputs

### Gaps

- **Button Gaps**: `gap-1` for small buttons, `gap-2` for medium buttons
- **Grid Gaps**: `gap-4` for card grids
- **Section Gaps**: `mb-4`, `mb-6`, `mb-8` for vertical spacing

### Grid Layouts

- **Receipt Cards**: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`
- **Group Cards**: Same as receipt cards when in grid
- **Form Grids**: `grid grid-cols-1 sm:grid-cols-2 gap-3` or similar

## Input Fields

### Input Styling

- **Base Classes**: `input` class with proper padding
- **Focus Ring**: `focus:ring-2 focus:ring-primary-500` (green focus ring)
- **Padding**: Ensure padding allows focus ring to be fully visible (use wrapper divs with `padding: '0 2px'` if needed)
- **Border Radius**: `rounded-lg` for all inputs
- **Date Inputs**: On mobile, ensure `font-size: 16px` to prevent zoom, and `border-radius: 0.5rem`

### Input Wrappers

- Wrap inputs in divs with `padding: '0 2px'` to ensure focus rings are fully visible
- Use `minHeight` to match display boxes (e.g., "Total Amount" should match "Items Total" height)

## Cards and Containers

### Card Styling

- **Base**: `card` class with rounded corners
- **Hover**: `hover:shadow-lg` for interactive cards
- **Transitions**: `transition-shadow` or `transition-all` for smooth interactions

### Group Cards

- **Background**: Faded version of group color (`rgba(r, g, b, 0.1)`)
- **Border**: Left border with group color (`borderLeft: '4px solid ${color}'`)
- **Expanded Content**: Full width below the card, not affecting card grid position

## Modals and Popups

### Modal Styling

- **Backdrop**: `bg-black bg-opacity-50`
- **Z-Index**: `z-50` for modals
- **Padding**: `p-4` for mobile, responsive padding
- **Max Width**: `max-w-md` for standard modals, `max-w-lg` for larger content

### Mobile Considerations

- **No `confirm()` dialogs**: Use custom modals instead to avoid popup blocking
- **Touch Targets**: Ensure buttons are at least 44x44px for touch
- **Scrollable Content**: Use `max-h-[90vh] overflow-y-auto` for long content

## Charts and Visualizations

### Chart Colors

- **Text Colors**: Adapt to dark mode
  - X/Y axis labels: `color: document.documentElement.classList.contains('dark') ? '#ffffff' : '#6b7280'`
  - Legend text: Same dark mode adaptation

### Chart Legends

- **Box Size**: `boxWidth: 12` and `boxHeight: 12` for square indicators
- **Point Style**: `usePointStyle: true`
- **Padding**: `padding: 10-12` for legend items
- **Font Size**: `size: 12-13` for legend text

## Group Management

### Group Display

- **Collapsed State**: Groups stay in grid layout (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3`)
- **Expanded State**: Group card stays in grid, expanded content appears below in full width
- **Nested Groups**: Display within parent groups, not in main grid

### Group Naming

- **Auto-numbering**: Use "Group 1", "Group 2", etc.
- **Gap Detection**: Fill gaps when groups are deleted (e.g., if Group 2 is deleted, next group becomes "Group 2")

## Drag and Drop

### Visual Feedback

- **Dragging**: `opacity: 0.5` on dragged element
- **Drag Over**: Highlight with color and dashed border
- **Touch Support**: Implement touch handlers for mobile drag-and-drop

## Form Elements

### Labels

- **Text Color**: `text-gray-700 dark:text-white` or `text-gray-900 dark:text-white`
- **Font Weight**: `font-medium` or `font-semibold`

### Select Dropdowns

- **Styling**: Match input field styling
- **Mobile**: Ensure proper touch targets

## Navigation and Layout

### Bottom Navigation

- **Padding**: Add `pb-24` to main content to prevent overlap
- **Fixed Position**: Navigation should be fixed at bottom

### Sidebar

- **Dark Mode**: Proper background and text colors
- **Transitions**: Smooth open/close animations

## Accessibility

- **Focus States**: Always visible focus rings
- **Color Contrast**: Ensure sufficient contrast in both light and dark modes
- **Touch Targets**: Minimum 44x44px for interactive elements
- **Keyboard Navigation**: Support keyboard navigation for all interactive elements

## Common Patterns

### Toast Notifications

- Use the Toast component from the store
- Types: 'success', 'error', 'info', 'warning'

### Loading States

- Use `Loader` component with `animate-spin`
- Show loading state during async operations

### Empty States

- Center content with appropriate messaging
- Provide helpful guidance text

## Dark Mode Specific Rules

1. **All non-colored text** (not green, red, or blue) should be white in dark mode
2. **Backgrounds** should use dark gray variants (`dark:bg-gray-800`, `dark:bg-gray-900`)
3. **Borders** should use `dark:border-gray-600` or similar
4. **Charts and graphs** should adapt text colors for dark mode
5. **Input fields** should have dark backgrounds with white text

## Responsive Breakpoints

- **sm**: 640px and up
- **md**: 768px and up
- **lg**: 1024px and up

Use these breakpoints consistently for responsive design.
