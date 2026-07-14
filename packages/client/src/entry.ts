// @web-forth/client bootstrap (SPEC.md §T.14, §I.svc). Builds the application and runs
// it via the browser runtime. The Vm service is provided app-wide through `resources`,
// so every Command (RunSource, ResetVm) gets it in the R channel.

import { Runtime } from 'foldkit'
import { init, Model, update, view } from './main'
import { VmLayer } from './vm'
import './styles.css'

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  container: document.getElementById('root'),
  resources: VmLayer,
})

Runtime.run(application)
