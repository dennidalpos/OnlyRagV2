import React, { Suspense, lazy } from 'react'
import type { PromptConfigurationModalProps } from './PromptConfigurationModal'

const Modal = lazy(() => import('./PromptConfigurationModal').then((module) => ({ default: module.PromptConfigurationModal })))

export const PromptConfigurationModal: React.FC<PromptConfigurationModalProps> = (props) =>
  props.isOpen ? (
    <Suspense fallback={null}>
      <Modal {...props} />
    </Suspense>
  ) : null
