import { I18n } from 'i18n-js'
import { InterviewLanguage } from '../../modules/interview/db/interview.types'

const loadI18n = () => {
	const i18n = new I18n({
		en: require('../../../lib/lang/en.json'),
		de: require('../../../lib/lang/de.json'),
		da: require('../../../lib/lang/da.json'),
		es: require('../../../lib/lang/es.json'),
		fr: require('../../../lib/lang/fr.json'),
		hi: require('../../../lib/lang/hi.json'),
		it: require('../../../lib/lang/it.json'),
		nl: require('../../../lib/lang/nl.json'),
		pl: require('../../../lib/lang/pl.json'),
		pt: require('../../../lib/lang/pt.json'),
		ru: require('../../../lib/lang/ru.json'),
		tr: require('../../../lib/lang/tr.json'),
		uk: require('../../../lib/lang/uk.json'),
	})
	i18n.defaultLocale = 'en'
	i18n.locale = 'en'

	return i18n
}

const i18n = loadI18n()

export const usei18n = () => {
	if (i18n) {
		return i18n
	}

	return loadI18n()
}

export const translate = (key: string,
	translateOpts?: { [key: string]: string },
	options?: { lang: keyof typeof InterviewLanguage }) => {
	const i18n = usei18n()

	i18n.locale = options?.lang || InterviewLanguage.en
	const translation = i18n.t(key, translateOpts)

	return translation
}
