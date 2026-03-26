import { Router, type IRouter } from "express";
import healthRouter from "./health";
import videoRouter from "./video";
import sourceRouter from "./source";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/video", videoRouter);
router.use("/source", sourceRouter);

export default router;
