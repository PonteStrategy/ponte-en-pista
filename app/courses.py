# SPDX-License-Identifier: AGPL-3.0-or-later
"""Cursos breves integrados (na versión real, eLearning de Odoo Community)."""
COURSES = [
    {"id": "cidadania", "audience": "citizen", "minutes": 4,
     "title": {"gl": "Reservar e entrar, paso a paso", "es": "Reservar y entrar, paso a paso"},
     "steps": [
         {"gl": "Consulta as instalacións sen conta: ves as franxas libres e a ficha con horario, normas, tarifa e modo de acceso.",
          "es": "Consulta las instalaciones sin cuenta: ves las franjas libres y la ficha con horario, normas, tarifa y modo de acceso."},
         {"gl": "Identifícate só ao reservar. Se a instalación ten tarifa de empadroados, necesitas identidade acreditada (Cl@ve, certificado ou alta na oficina).",
          "es": "Identifícate solo al reservar. Si la instalación tiene tarifa de empadronados, necesitas identidad acreditada (Cl@ve, certificado o alta en la oficina)."},
         {"gl": "Antes de confirmar ves que regra se che aplica e cando poderás reservar de novo.",
          "es": "Antes de confirmar ves qué regla se te aplica y cuándo podrás reservar de nuevo."},
         {"gl": "Gardas o QR no móbil: vale só para esa instalación e esa franxa, e funciona sen cobertura. Tamén tes un código de 6 díxitos.",
          "es": "Guardas el QR en el móvil: vale solo para esa instalación y esa franja, y funciona sin cobertura. También tienes un código de 6 dígitos."},
         {"gl": "Na porta automatizada, preme «Abrir a porta» e, en 30 segundos, o pulsador verde da porta. Se hai un problema, usa «Teño un problema».",
          "es": "En la puerta automatizada, pulsa «Abrir la puerta» y, en 30 segundos, el pulsador verde de la puerta. Si hay un problema, usa «Tengo un problema»."}],
     "quiz": [
         {"q": {"gl": "Canto tempo tes para premer o pulsador despois de «Abrir a porta»?", "es": "¿Cuánto tiempo tienes para pulsar tras «Abrir la puerta»?"},
          "options": {"gl": ["10 segundos", "30 segundos", "5 minutos"], "es": ["10 segundos", "30 segundos", "5 minutos"]}, "answer": 1},
         {"q": {"gl": "Que fas se non hai cobertura no móbil?", "es": "¿Qué haces si no hay cobertura en el móvil?"},
          "options": {"gl": ["Nada, non podo entrar", "Uso o QR ou o código alternativo", "Chamo ao 112"], "es": ["Nada, no puedo entrar", "Uso el QR o el código alternativo", "Llamo al 112"]}, "answer": 1}]},
    {"id": "xestion", "audience": "manager", "minutes": 6,
     "title": {"gl": "Persoa xestora: instalacións, regras e tarifas", "es": "Persona gestora: instalaciones, reglas y tarifas"},
     "steps": [
         {"gl": "Dá de alta a instalación: horarios por tempada, festivos, modo de acceso (persoal ou porta automatizada) e persoal validador.",
          "es": "Da de alta la instalación: horarios por temporada, festivos, modo de acceso (personal o puerta automatizada) y personal validador."},
         {"gl": "Fixa as regras de reparto do concello e axústaas por instalación: ventá, máximos, espera e penalización.",
          "es": "Fija las reglas de reparto del concello y ajústalas por instalación: ventana, máximos, espera y penalización."},
         {"gl": "Para quen chama ou vai á oficina, usa «Reserva asistida»: comprobas o documento, rexistras as normas e imprimes o QR.",
          "es": "Para quien llama o va a la oficina, usa «Reserva asistida»: compruebas el documento, registras las normas e imprimes el QR."},
         {"gl": "Se unha instalación se avería, péchala: as franxas desaparecen do catálogo e avísase a quen tiña reserva.",
          "es": "Si una instalación se avería, ciérrala: las franjas desaparecen del catálogo y se avisa a quien tenía reserva."}],
     "quiz": [
         {"q": {"gl": "Unha excepción ás regras na reserva asistida...", "es": "Una excepción a las reglas en la reserva asistida..."},
          "options": {"gl": ["Non queda anotada", "Queda anotada con motivo e persoa", "Non se pode facer"], "es": ["No queda anotada", "Queda anotada con motivo y persona", "No se puede hacer"]}, "answer": 1}]},
    {"id": "validacion", "audience": "validator", "minutes": 3,
     "title": {"gl": "Persoa validadora: ler o QR e traballar sen conexión", "es": "Persona validadora: leer el QR y trabajar sin conexión"},
     "steps": [
         {"gl": "Abre «Validar acceso» e le o QR coa cámara ou teclea o código alternativo.",
          "es": "Abre «Validar acceso» y lee el QR con la cámara o teclea el código alternativo."},
         {"gl": "Verás o motivo se se rexeita: outro día, cancelado ou doutra instalación.",
          "es": "Verás el motivo si se rechaza: otro día, cancelado u otra instalación."},
         {"gl": "Sen conexión, usa a lista do día gardada: busca por apelidos, comproba a identidade e marca a entrada. Envíase ao recuperar a rede.",
          "es": "Sin conexión, usa la lista del día guardada: busca por apellidos, comprueba la identidad y marca la entrada. Se envía al recuperar la red."}],
     "quiz": [
         {"q": {"gl": "Cando se envían as entradas marcadas sen conexión?", "es": "¿Cuándo se envían las entradas marcadas sin conexión?"},
          "options": {"gl": ["Nunca", "Ao recuperar a rede", "Ao día seguinte por correo"], "es": ["Nunca", "Al recuperar la red", "Al día siguiente por correo"]}, "answer": 1}]},
]
