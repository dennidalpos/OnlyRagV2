import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlanPanelChecklistView } from './PlanPanelChecklistView'

describe('PlanPanelChecklistView', () => {
  it('shows only the selected milestone as in progress when saved statuses overlap', () => {
    const markup = renderToStaticMarkup(
      <PlanPanelChecklistView
        version={1}
        parsedChecklist={[
          { id: 'm-1', title: 'First', completed: false, status: 'in_progress' },
          { id: 'm-2', title: 'Second', completed: false, status: 'in_progress' },
        ]}
        completedItemsCount={0}
        totalItems={2}
        progressPercent={0}
        isExecuting={true}
        activeIndex={0}
      />,
    )

    expect(markup.match(/IN CORSO/g)).toHaveLength(1)
  })
})
