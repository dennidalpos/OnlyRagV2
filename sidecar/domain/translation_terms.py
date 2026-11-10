"""Reviewed Italian administrative terms; source values are never stored here."""
from typing import Dict, Optional, Tuple

LANGUAGES = ("english", "german", "french", "spanish", "portuguese", "russian", "chinese", "japanese")

# Scope and primary terminology sources: docs/translation-language-audit-2026-10-13.md.
TERMS = {
    "alternative": ("or", "oder", "ou", "o", "ou", "либо", "或", "または"),
    "postal_box": (
        "P.O. Box {box}, branch {branch}", "Postfach {box}, Zweigstelle {branch}",
        "boîte postale {box}, succursale {branch}", "apartado postal {box}, sucursal {branch}",
        "apartado postal {box}, sucursal {branch}", "абонентский ящик {box}, отделение {branch}",
        "邮政信箱{box}，支局{branch}", "私書箱{box}、支局{branch}",
    ),
    "postal": (
        "registered mail with advice of delivery", "Einschreiben mit Rückschein",
        "courrier recommandé avec avis de réception", "correo certificado con aviso de recibo",
        "correio registado com aviso de receção", "заказное письмо с уведомлением о вручении",
        "附回执的挂号邮件", "受取通知付き書留郵便",
    ),
    "pec": (
        "certified email (PEC)", "zertifizierte elektronische Post (PEC)",
        "courrier électronique certifié (PEC)", "correo electrónico certificado (PEC)",
        "correio eletrónico certificado (PEC)", "сертифицированная электронная почта (PEC)",
        "认证电子邮件（PEC）", "認証電子メール（PEC）",
    ),
    "call_center": (
        "Call Center", "Callcenter", "centre d'appels", "centro de atención telefónica",
        "centro de atendimento telefónico", "телефонный центр обслуживания", "电话客服中心", "コールセンター",
    ),
    "termination_request": (
        "request for termination of the contract", "Antrag auf Beendigung des Vertrags",
        "demande de résiliation du contrat", "solicitud de terminación del contrato",
        "pedido de cessação do contrato", "заявление о прекращении договора", "合同终止申请", "契約終了申請",
    ),
}

# Exact standard clauses only; unknown conditions and extra instructions require the model.
FORM_CLAUSES = {
    "postal_submission": (
        "sent by postal mail to {company} - Customer Care, {postal_box} - {locality} {address}.",
        "per Post an {company} - Customer Care, {postal_box} - {locality} {address} gesendet.",
        "envoyé par courrier postal à {company} - Customer Care, {postal_box} - {locality} {address}.",
        "enviado por correo postal a {company} - Customer Care, {postal_box} - {locality} {address}.",
        "enviado por correio postal para {company} - Customer Care, {postal_box} - {locality} {address}.",
        "отправлен обычной почтой по адресу: {company} - Customer Care, {postal_box} - {locality} {address}.",
        "通过邮政寄送至{company} - Customer Care，{postal_box} - {locality} {address}。",
        "郵便で{company} - Customer Care（{postal_box} - {locality} {address}）宛てに送付してください。",
    ),
    "physical_return": (
        "Following exercise of the right to withdraw from the {contract} contract, the {device} device must be returned according to the instructions provided by {company}, by personally visiting sales or assistance points, whose list is available through the website and the {company} Call Center",
        "Nach Ausübung des Widerrufsrechts aus dem Vertrag {contract} ist das Gerät {device} gemäß den Anweisungen von {company} zurückzugeben, indem Sie die Verkaufsstellen oder Servicestellen persönlich aufsuchen, deren Liste über die Website und das Callcenter von {company} verfügbar ist",
        "Après avoir exercé le droit de rétractation du contrat {contract}, le dispositif {device} doit être restitué selon les instructions fournies par {company}, en vous rendant directement dans les points de vente ou d'assistance, dont la liste est disponible sur le site web et auprès du centre d'appels de {company}",
        "Tras ejercer el derecho de desistimiento del contrato {contract}, el dispositivo {device} deberá devolverse según las instrucciones de {company}, acudiendo personalmente a los puntos de venta o de asistencia, cuya lista está disponible en el sitio web y en el centro de atención telefónica de {company}",
        "Após exercer o direito de desistência do contrato {contract}, o dispositivo {device} deve ser devolvido de acordo com as instruções de {company}, dirigindo-se pessoalmente aos pontos de venda ou de assistência, cuja lista está disponível no site e no centro de atendimento telefónico de {company}",
        "После осуществления права на отказ от договора {contract} устройство {device} должно быть возвращено согласно инструкциям {company}, лично посетив пункты продаж или обслуживания, список которых доступен на сайте и через телефонный центр обслуживания {company}",
        "行使{contract}合同的解除权后，应按照{company}提供的指示归还{device}设备，可亲自前往销售或服务网点，其名单可通过网站和{company}电话客服中心查询",
        "{contract}の契約解除権を行使した後、{device}の装置を{company}の指示に従って返却する必要があります。販売店またはサポート窓口に直接持参できます（一覧はウェブサイトと{company}のコールセンターで確認できます）",
    ),
    "postal_return": (
        "by sending it by registered mail with advice of delivery to {company} Customer Care, {address}.",
        "durch Versand per Einschreiben mit Rückschein an {company} Customer Care, {address}.",
        "en l'expédiant par courrier recommandé avec avis de réception à {company} Customer Care, {address}.",
        "enviándolo por correo certificado con aviso de recibo a {company} Customer Care, {address}.",
        "enviando-o por correio registado com aviso de receção para {company} Customer Care, {address}.",
        "отправив его заказным письмом с уведомлением о вручении по адресу: {company} Customer Care, {address}.",
        "通过附回执的挂号邮件寄送至{company} Customer Care，{address}。",
        "受取通知付き書留郵便で{company} Customer Care（{address}）宛てに送付してください。",
    ),
}

FORM_LABELS = {
    "n.": ("No.", "Nr.", "n°", "n.º", "n.º", "№", "编号", "番号"),
    "nome": ("given name", "Vorname", "prénom", "nombre", "nome", "имя", "名", "名"),
    "cognome": ("surname", "Nachname", "nom de famille", "apellido", "apelido", "фамилия", "姓", "姓"),
    "codice fiscale": (
        "tax identification code", "Steueridentifikationscode", "code d'identification fiscale", "código de identificación fiscal",
        "código de identificação fiscal", "налоговый идентификационный код", "税务识别代码", "納税者識別コード",
    ),
    "indirizzo residenza": (
        "residence address", "Wohnanschrift", "adresse de résidence", "dirección de residencia",
        "morada de residência", "адрес проживания", "居住地址", "居住住所",
    ),
    "n° civico": ("house number", "Hausnummer", "numéro de maison", "número de vivienda", "número de porta", "номер дома", "门牌号", "住居番号"),
    "località": ("locality", "Ort", "localité", "localidad", "localidade", "населённый пункт", "所在地", "所在地"),
    "cap": ("postal code", "Postleitzahl", "code postal", "código postal", "código postal", "почтовый индекс", "邮政编码", "郵便番号"),
    "prov": ("province", "Provinz", "province", "provincia", "província", "провинция", "省份", "県"),
    "contratto": ("contract number", "Vertragsnummer", "numéro de contrat", "número de contrato", "número de contrato", "номер договора", "合同编号", "契約番号"),
    "firma leggibile del cliente": (
        "legible customer signature", "leserliche Unterschrift des Kunden", "signature lisible du client", "firma legible del cliente",
        "assinatura legível do cliente", "разборчивая подпись клиента", "客户清晰签名", "顧客の判読可能な署名",
    ),
    "luogo e data": ("place and date", "Ort und Datum", "lieu et date", "lugar y fecha", "local e data", "место и дата", "地点和日期", "場所と日付"),
    "il sottoscritto": ("the undersigned", "der Unterzeichner", "le soussigné", "el abajo firmante", "o abaixo-assinado", "нижеподписавшийся", "以下签署人", "署名者"),
    "spett.le": ("To the attention of:", "An:", "À l'attention de :", "A la atención de:", "À atenção de:", "Кому:", "致：", "宛先："),
}



def term_translation(terms: Dict[str, Tuple[str, ...]], key: str, target_language: str) -> Optional[str]:
    language = target_language.strip().casefold()
    if key not in terms or language not in LANGUAGES:
        return None
    return terms[key][LANGUAGES.index(language)]
