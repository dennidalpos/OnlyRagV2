import { HardwareProfile } from '../types'
import { TranslationKey } from '../i18n'

export interface HardwareProfileDef {
  id: HardwareProfile
  name: string
  desc: string
  vram: string
}

/**
 * Single source of truth for hardware profile copy, shared between the Settings
 * page (HardwareProfileSelector) and the Setup Wizard (WizardStepPreferences) so
 * both surfaces present identical names/descriptions for the same settings.hardwareProfile value.
 */
export function getHardwareProfileDefs(t: (key: TranslationKey, params?: Record<string, string | number>) => string): HardwareProfileDef[] {
  return [
    { id: 'Auto', name: 'Auto', desc: t('settings.autoScaleDesc'), vram: 'Dynamic' },
    { id: 'Low', name: t('settings.hardwareProfileLowName'), desc: t('settings.hardwareProfileLowDesc'), vram: 'CPU RAM' },
    { id: 'Medium', name: t('settings.hardwareProfileMediumName'), desc: t('settings.hardwareProfileMediumDesc'), vram: '8 GB' },
    { id: 'High', name: t('settings.hardwareProfileHighName'), desc: t('settings.hardwareProfileHighDesc'), vram: '12+ GB' },
  ]
}
