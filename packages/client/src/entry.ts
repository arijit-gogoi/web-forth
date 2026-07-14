// @web-forth/client bootstrap (SPEC.md §T.14, §I.svc). Builds the application and runs
// it via the browser runtime. The Vm service is provided app-wide through `resources`,
// so every Command (RunSource, ResetVm) gets it in the R channel.

import { Runtime } from 'foldkit'
import { Flags, flags, init, Model, update, view } from './main'
import { VmLayer } from './vm'
import './styles.css'

// flags reads the saved editor buffer from localStorage before init (§T.25), so the
// restored text is in the Model when the CM6 editor captures its initialDoc.
const application = Runtime.makeApplication({
  Model,
  Flags,
  flags,
  init,
  update,
  view,
  container: document.getElementById('root'),
  resources: VmLayer,
})

Runtime.run(application)
